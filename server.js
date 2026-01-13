// server.js
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Инициализация Firebase
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Telegram Bot API токен (берется из конфигурации бота)
const BOT_TOKENS = {
  'bot1_id': '1234567890:AAHskXrI0NOPttX6r2xDkLhfYWcOtq0YKU',
  'bot2_id': '0987654321:BBHRskXrI0NOPttX6r2xDkLhfYWcOtq0YKU'
};

// 1. Эндпоинт для проверки статуса пользователя
app.post('/api/status', async (req, res) => {
  try {
    const { user_id, bot_id } = req.body;
    
    const botRef = db.collection('bots').doc(bot_id);
    const userRef = botRef.collection('users').doc(String(user_id));
    
    const [botDoc, userDoc] = await Promise.all([
      botRef.get(),
      userRef.get()
    ]);
    
    if (!botDoc.exists) {
      return res.status(404).json({ error: 'Бот не найден' });
    }
    
    const botData = botDoc.data();
    let userData = null;
    
    if (userDoc.exists) {
      userData = userDoc.data();
    } else {
      // Создаем нового пользователя
      const today = new Date().toDateString();
      userData = {
        userId: String(user_id),
        telegramId: String(user_id),
        username: req.body.username || '',
        firstName: '',
        lastName: '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        spins: [],
        prizes: [],
        invitedUsers: [],
        referralCode: `REF_${String(user_id).slice(-8)}`,
        totalSpins: 0,
        totalPrizes: 0,
        dailyStats: {
          [today]: { spins: 0 }
        },
        attempts_left: botData.limits?.spinsPerDay || 3,
        lastSpin: null,
        referrals: 0,
        ref_link: `https://t.me/${botData.botUsername}?start=uid_${user_id}`
      };
      
      await userRef.set(userData);
    }
    
    // Рассчитываем оставшиеся попытки
    const today = new Date().toDateString();
    const spinsToday = userData.spins?.filter(spin => {
      const spinDate = spin.date?.toDate?.().toDateString() || new Date(spin.date).toDateString();
      return spinDate === today;
    }).length || 0;
    
    const maxSpins = botData.limits?.spinsPerDay || 3;
    const attempts_left = Math.max(0, maxSpins - spinsToday);
    
    res.json({
      attempts_left,
      spins_today: spinsToday,
      total_spins: userData.totalSpins || 0,
      total_prizes: userData.totalPrizes || 0,
      referrals: userData.invitedUsers?.length || 0,
      ref_link: userData.ref_link || `https://t.me/${botData.botUsername}?start=uid_${user_id}`,
      cooldown: userData.lastSpin ? 
        (new Date(userData.lastSpin.toDate()).getTime() + ((botData.limits?.cooldownSeconds || 3600) * 1000)) - Date.now() : 0
    });
    
  } catch (error) {
    console.error('Error in /api/status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Эндпоинт для проверки подписки
app.post('/api/check-subscribe', async (req, res) => {
  try {
    const { user_id, bot_id } = req.body;
    
    const botRef = db.collection('bots').doc(bot_id);
    const botDoc = await botRef.get();
    
    if (!botDoc.exists) {
      return res.status(404).json({ error: 'Бот не найден' });
    }
    
    const botData = botDoc.data();
    const channelUsername = botData.subscription?.channelUsername;
    
    if (!channelUsername || !botData.features?.requireSubscription) {
      return res.json({ subscribed: true });
    }
    
    // Проверяем подписку через Telegram Bot API
    const botToken = BOT_TOKENS[bot_id] || botData.botToken;
    
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${botToken}/getChatMember`,
        {
          params: {
            chat_id: channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`,
            user_id: user_id
          }
        }
      );
      
      const status = response.data.result.status;
      const isSubscribed = ['creator', 'administrator', 'member'].includes(status);
      
      res.json({ subscribed: isSubscribed });
    } catch (error) {
      console.error('Error checking subscription:', error);
      res.json({ subscribed: false });
    }
    
  } catch (error) {
    console.error('Error in /api/check-subscribe:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. Эндпоинт для получения конфигурации колеса
app.get('/api/wheel-config', async (req, res) => {
  try {
    const bot_id = req.query.bot_id;
    
    if (!bot_id) {
      return res.status(400).json({ error: 'bot_id is required' });
    }
    
    const botRef = db.collection('bots').doc(bot_id);
    const botDoc = await botRef.get();
    
    if (!botDoc.exists) {
      return res.status(404).json({ error: 'Бот не найден' });
    }
    
    const botData = botDoc.data();
    const prizes = botData.wheel?.prizes || [];
    
    // Преобразуем призы в формат для HTML
    const items = prizes
      .filter(prize => prize.isAvailable !== false)
      .map((prize, index) => ({
        id: prize.id || index + 1,
        label: prize.text || `Приз ${index + 1}`,
        win_text: prize.description || `Поздравляем! Вы выиграли ${prize.text}!`,
        value: prize.value || 0,
        probability: prize.probability || (1 / prizes.length),
        type: prize.type || 'points',
        color: prize.color || '#B31414'
      }));
    
    res.json({
      items,
      spin_duration: botData.wheel?.spinDuration || 5,
      rotation_count: botData.wheel?.rotationCount || 5
    });
    
  } catch (error) {
    console.error('Error in /api/wheel-config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. Эндпоинт для вращения колеса
app.post('/api/spin', async (req, res) => {
  try {
    const { user_id, bot_id, referrer_id } = req.body;
    
    const botRef = db.collection('bots').doc(bot_id);
    const userRef = botRef.collection('users').doc(String(user_id));
    
    const [botDoc, userDoc] = await Promise.all([
      botRef.get(),
      userRef.get()
    ]);
    
    if (!botDoc.exists) {
      return res.status(404).json({ error: 'Бот не найден' });
    }
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const botData = botDoc.data();
    const userData = userDoc.data();
    
    // Проверка дневного лимита
    const today = new Date().toDateString();
    const spinsToday = userData.spins?.filter(spin => {
      const spinDate = spin.date?.toDate?.().toDateString() || new Date(spin.date).toDateString();
      return spinDate === today;
    }).length || 0;
    
    const maxSpins = botData.limits?.spinsPerDay || 3;
    
    if (spinsToday >= maxSpins) {
      return res.status(400).json({ error: 'Дневной лимит исчерпан' });
    }
    
    // Проверка кулдауна
    if (userData.lastSpin) {
      const lastSpinTime = userData.lastSpin.toDate ? userData.lastSpin.toDate().getTime() : new Date(userData.lastSpin).getTime();
      const cooldownSeconds = botData.limits?.cooldownSeconds || 3600;
      const cooldownEnd = lastSpinTime + (cooldownSeconds * 1000);
      
      if (Date.now() < cooldownEnd) {
        return res.status(400).json({ 
          error: `Следующий спин через: ${Math.ceil((cooldownEnd - Date.now()) / 1000)} сек.` 
        });
      }
    }
    
    // Обработка реферера
    if (referrer_id && String(referrer_id) !== String(user_id)) {
      const referrerRef = botRef.collection('users').doc(String(referrer_id));
      const referrerDoc = await referrerRef.get();
      
      if (referrerDoc.exists && !userData.referrer_processed) {
        const referrerData = referrerDoc.data();
        
        // Обновляем данные реферера
        await referrerRef.update({
          invitedUsers: admin.firestore.FieldValue.arrayUnion(user_id),
          referrals: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Отмечаем, что реферер обработан
        await userRef.update({
          referrer_processed: true,
          referrer_id: referrer_id
        });
      }
    }
    
    // Выбор приза на основе вероятности
    const availablePrizes = (botData.wheel?.prizes || []).filter(p => p.isAvailable !== false);
    if (availablePrizes.length === 0) {
      return res.status(400).json({ error: 'Нет доступных призов' });
    }
    
    const totalProbability = availablePrizes.reduce((sum, p) => sum + (p.probability || 0), 0);
    let random = Math.random() * totalProbability;
    let selectedPrize = availablePrizes[0];
    
    for (const prize of availablePrizes) {
      if (random < prize.probability) {
        selectedPrize = prize;
        break;
      }
      random -= prize.probability;
    }
    
    // Генерация ID спина
    const spin_id = `spin_${Date.now()}_${user_id}`;
    
    // Сохранение спина
    const spinRecord = {
      spin_id,
      user_id,
      prize_id: selectedPrize.id,
      prize_text: selectedPrize.text,
      prize_value: selectedPrize.value,
      prize_type: selectedPrize.type,
      date: admin.firestore.FieldValue.serverTimestamp(),
      claimed: false
    };
    
    await userRef.update({
      spins: admin.firestore.FieldValue.arrayUnion(spinRecord),
      totalSpins: admin.firestore.FieldValue.increment(1),
      lastSpin: admin.firestore.FieldValue.serverTimestamp(),
      [`dailyStats.${today}.spins`]: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Обновляем статистику бота
    await botRef.update({
      totalSpins: admin.firestore.FieldValue.increment(1)
    });
    
    // Если приз не "none" типа, сохраняем его
    if (selectedPrize.type !== 'none') {
      const prizeRecord = {
        ...spinRecord,
        claimDate: null,
        expiryDate: new Date(Date.now() + ((botData.limits?.prizeExpiryDays || 7) * 24 * 60 * 60 * 1000))
      };
      
      await userRef.update({
        prizes: admin.firestore.FieldValue.arrayUnion(prizeRecord),
        totalPrizes: admin.firestore.FieldValue.increment(1)
      });
      
      await botRef.update({
        totalPrizes: admin.firestore.FieldValue.increment(1)
      });
    }
    
    // Отправляем результат пользователю в Telegram
    const botToken = BOT_TOKENS[bot_id] || botData.botToken;
    if (botToken && selectedPrize.type !== 'none') {
      try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: user_id,
          text: `🎉 Поздравляем! Вы выиграли: ${selectedPrize.text}\n\nПриз будет действителен до ${new Date(Date.now() + ((botData.limits?.prizeExpiryDays || 7) * 24 * 60 * 60 * 1000)).toLocaleDateString('ru-RU')}`,
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error('Error sending Telegram notification:', error);
      }
    }
    
    res.json({
      success: true,
      spin_id,
      prize: selectedPrize.text,
      prize_type: selectedPrize.type,
      prize_value: selectedPrize.value,
      attempts_left: Math.max(0, maxSpins - (spinsToday + 1))
    });
    
  } catch (error) {
    console.error('Error in /api/spin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. Эндпоинт для отправки лида
app.post('/api/submit-lead', async (req, res) => {
  try {
    const { user_id, spin_id, bot_id, name, phone } = req.body;
    
    const botRef = db.collection('bots').doc(bot_id);
    const userRef = botRef.collection('users').doc(String(user_id));
    
    const botDoc = await botRef.get();
    
    if (!botDoc.exists) {
      return res.status(404).json({ error: 'Бот не найден' });
    }
    
    const botData = botDoc.data();
    
    // Находим спин и обновляем его
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      const updatedSpins = userData.spins?.map(spin => {
        if (spin.spin_id === spin_id) {
          return {
            ...spin,
            lead_submitted: true,
            lead_data: { name, phone, submitted_at: new Date().toISOString() }
          };
        }
        return spin;
      });
      
      await userRef.update({
        spins: updatedSpins || userData.spins,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    // Отправляем в Telegram (если настроен канал для лидов)
    const leadsTargetId = botData.telegram?.leadsTargetId;
    const botToken = BOT_TOKENS[bot_id] || botData.botToken;
    
    if (leadsTargetId && botToken) {
      try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: leadsTargetId,
          text: `📋 Новый лид от пользователя @${req.body.username || 'без username'}\n\n👤 Имя: ${name}\n📱 Телефон: ${phone || 'не указан'}\n🎁 Приз: ${req.body.prize || 'неизвестно'}\n🆔 User ID: ${user_id}`,
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error('Error sending lead to Telegram:', error);
      }
    }
    
    res.json({ success: true, message: 'Данные успешно сохранены' });
    
  } catch (error) {
    console.error('Error in /api/submit-lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 6. Фолбэк для лида (если пользователь не заполнил форму)
app.post('/api/lead-fallback', async (req, res) => {
  try {
    const { user_id, spin_id, bot_id } = req.body;
    
    const botRef = db.collection('bots').doc(bot_id);
    const userRef = botRef.collection('users').doc(String(user_id));
    
    const botDoc = await botRef.get();
    
    if (!botDoc.exists) {
      return res.status(404).json({ error: 'Бот не найден' });
    }
    
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      const updatedSpins = userData.spins?.map(spin => {
        if (spin.spin_id === spin_id) {
          return {
            ...spin,
            lead_fallback: true,
            fallback_time: new Date().toISOString()
          };
        }
        return spin;
      });
      
      await userRef.update({
        spins: updatedSpins || userData.spins,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    res.json({ success: true, message: 'Фолбэк применен' });
    
  } catch (error) {
    console.error('Error in /api/lead-fallback:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 7. Получение статистики бота
app.get('/api/bot-stats/:bot_id', async (req, res) => {
  try {
    const { bot_id } = req.params;
    
    const botRef = db.collection('bots').doc(bot_id);
    const botDoc = await botRef.get();
    
    if (!botDoc.exists) {
      return res.status(404).json({ error: 'Бот не найден' });
    }
    
    // Получаем всех пользователей бота
    const usersSnapshot = await botRef.collection('users').get();
    const users = usersSnapshot.docs.map(doc => doc.data());
    
    const stats = {
      total_users: users.length,
      total_spins: users.reduce((sum, user) => sum + (user.totalSpins || 0), 0),
      total_prizes: users.reduce((sum, user) => sum + (user.totalPrizes || 0), 0),
      today_spins: users.reduce((sum, user) => {
        const today = new Date().toDateString();
        const spinsToday = user.spins?.filter(spin => {
          const spinDate = spin.date?.toDate?.().toDateString() || new Date(spin.date).toDateString();
          return spinDate === today;
        }).length || 0;
        return sum + spinsToday;
      }, 0),
      referrals: users.reduce((sum, user) => sum + (user.invitedUsers?.length || 0), 0)
    };
    
    res.json(stats);
    
  } catch (error) {
    console.error('Error in /api/bot-stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Обслуживание статических файлов
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
