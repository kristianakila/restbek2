const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

// Конфигурация CORS
app.use(cors({
  origin: function(origin, callback) {
    if (process.env.NODE_ENV !== 'production') return callback(null, true);

    const allowedOrigins = [
      'https://web.telegram.org',
      'https://yourdomain.com',
      'https://*.yourdomain.com'
    ];

    if (!origin || allowedOrigins.some(allowed => origin === allowed || origin.endsWith(allowed.slice(1)))) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === Инициализация Firebase ===
let db;
try {
  const keyPath = path.join(__dirname, 'firebasekey.json');
  console.log("🔐 Loading Firebase key from:", keyPath);

  if (!fs.existsSync(keyPath)) {
    console.error("❌ firebasekey.json NOT FOUND at:", keyPath);
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  db = admin.firestore();
  console.log("✅ Firebase initialized via firebasekey.json");
} catch (error) {
  console.error("❌ Firebase initialization error:", error);
  process.exit(1);
}

// === Глобальный кеш конфигурации ботов ===
const botConfigCache = new Map();
const CACHE_TTL = 60000; // 1 минута

// === Получение конфигурации бота с кешированием ===
async function getBotConfig(botId) {
  if (!botId) throw new Error('Bot ID is required');

  // Проверяем кеш
  const cached = botConfigCache.get(botId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.config;
  }

  try {
    const botRef = db.collection('bots').doc(botId);
    const botDoc = await botRef.get();

    if (!botDoc.exists) {
      console.error(`Bot ${botId} not found in Firestore`);
      return null;
    }

    const config = {
      id: botId,
      ...botDoc.data(),
      botToken: botDoc.data().botToken || process.env[`BOT_TOKEN_${botId}`] || process.env.BOT_TOKEN
    };

    botConfigCache.set(botId, { config, timestamp: Date.now() });
    console.log(`✅ Loaded config for bot: ${botId}`);
    return config;
  } catch (error) {
    console.error(`Error loading config for bot ${botId}:`, error);
    return null;
  }
}

module.exports = { app, getBotConfig, db };


// Функция для получения пользователя
async function getUserData(botId, userId) {
  try {
    const userRef = db.collection('bots').doc(botId).collection('users').doc(String(userId));
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      return userDoc;
    }
    return null;
  } catch (error) {
    console.error(`Error getting user ${userId} for bot ${botId}:`, error);
    throw error;
  }
}

// Функция для создания нового пользователя
async function createUser(botId, userId, userData) {
  try {
    const userRef = db.collection('bots').doc(botId).collection('users').doc(String(userId));
    const today = new Date().toDateString();
    
    const newUserData = {
      userId: String(userId),
      telegramId: String(userId),
      username: userData.username || '',
      firstName: userData.first_name || '',
      lastName: userData.last_name || '',
      languageCode: userData.language_code || 'ru',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      spins: [],
      prizes: [],
      invitedUsers: [],
      referralCode: `REF_${String(userId).slice(-8)}`,
      totalSpins: 0,
      totalPrizes: 0,
      dailyStats: {
        [today]: { spins: 0 }
      },
      attempts_left: 3, // По умолчанию
      lastSpin: null,
      referrals: 0,
      ref_link: `https://t.me/${userData.bot_username || 'bot'}?start=uid_${userId}`,
      referrer_processed: false
    };
    
    await userRef.set(newUserData);
    
    // Обновляем счетчик пользователей бота
    const botRef = db.collection('bots').doc(botId);
    await botRef.update({
      usersCount: admin.firestore.FieldValue.increment(1)
    });
    
    return newUserData;
  } catch (error) {
    console.error(`Error creating user ${userId} for bot ${botId}:`, error);
    throw error;
  }
}

// Миддлварь для логирования
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`, req.query);
  next();
});

// Определение бота из запроса
app.use(async (req, res, next) => {
  try {
    let botId = null;
    
    // 1. Из поддомена (bot1.domain.com)
    const hostname = req.hostname;
    if (hostname.includes('.')) {
      const subdomain = hostname.split('.')[0];
      if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
        botId = subdomain;
      }
    }
    
    // 2. Из пути (/bot1/api/...)
    if (!botId && req.path.startsWith('/bot/')) {
      const pathParts = req.path.split('/');
      if (pathParts[2]) {
        botId = pathParts[2];
        // Редактируем путь для следующих middleware
        req.originalPath = req.path;
        req.path = '/' + pathParts.slice(3).join('/');
      }
    }
    
    // 3. Из query параметра (?bot_id=bot123)
    if (!botId && req.query.bot_id) {
      botId = req.query.bot_id;
    }
    
    // 4. Из заголовка (X-Bot-ID)
    if (!botId && req.headers['x-bot-id']) {
      botId = req.headers['x-bot-id'];
    }
    
    // 5. Из тела запроса
    if (!botId && req.body && req.body.bot_id) {
      botId = req.body.bot_id;
    }
    
    if (botId) {
      const botConfig = await getBotConfig(botId);
      if (botConfig) {
        req.botId = botId;
        req.botConfig = botConfig;
      } else {
        return res.status(404).json({ 
          error: 'Bot not found',
          message: `Bot with ID "${botId}" does not exist`
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Error in bot detection middleware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Эндпоинт для проверки статуса сервера
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized ? 'connected' : 'disconnected',
    botsLoaded: botConfigCache.size
  });
});

// 1. Эндпоинт для проверки статуса пользователя
app.post('/api/status', async (req, res) => {
  try {
    const { user_id, username } = req.body;
    
    if (!req.botId || !req.botConfig) {
      return res.status(400).json({ 
        error: 'Bot identification required',
        message: 'Specify bot_id in query, header, or path'
      });
    }
    
    if (!user_id) {
      return res.status(400).json({ 
        error: 'user_id is required' 
      });
    }
    
    const botId = req.botId;
    const botConfig = req.botConfig;
    
    console.log(`[${botId}] Status check for user: ${user_id}`);
    
    let userData = null;
    const userDoc = await getUserData(botId, user_id);
    
    if (userDoc && userDoc.exists) {
      userData = userDoc.data();
      console.log(`[${botId}] User ${user_id} found in database`);
    } else {
      // Создаем нового пользователя
      console.log(`[${botId}] Creating new user: ${user_id}`);
      userData = await createUser(botId, user_id, {
        username: username || '',
        bot_username: botConfig.botUsername
      });
    }
    
    // Рассчитываем оставшиеся попытки
    const today = new Date().toDateString();
    const spinsToday = userData.spins?.filter(spin => {
      if (!spin.date) return false;
      const spinDate = spin.date.toDate ? 
        spin.date.toDate().toDateString() : 
        new Date(spin.date).toDateString();
      return spinDate === today;
    }).length || 0;
    
    const maxSpins = botConfig.limits?.spinsPerDay || 3;
    const attempts_left = Math.max(0, maxSpins - spinsToday);
    
    // Проверяем кулдаун
    let cooldown_remaining = 0;
    if (userData.lastSpin) {
      const lastSpinTime = userData.lastSpin.toDate ? 
        userData.lastSpin.toDate().getTime() : 
        new Date(userData.lastSpin).getTime();
      const cooldownSeconds = botConfig.limits?.cooldownSeconds || 3600;
      const cooldownEnd = lastSpinTime + (cooldownSeconds * 1000);
      
      if (Date.now() < cooldownEnd) {
        cooldown_remaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
      }
    }
    
    res.json({
      success: true,
      bot_id: botId,
      bot_name: botConfig.name,
      user_id: user_id,
      attempts_left,
      spins_today: spinsToday,
      total_spins: userData.totalSpins || 0,
      total_prizes: userData.totalPrizes || 0,
      referrals: userData.invitedUsers?.length || 0,
      ref_link: userData.ref_link || `https://t.me/${botConfig.botUsername}?start=uid_${user_id}`,
      cooldown: cooldown_remaining,
      is_new_user: !userDoc || !userDoc.exists
    });
    
  } catch (error) {
    console.error('Error in /api/status:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// 2. Эндпоинт для проверки подписки на канал
app.post('/api/check-subscribe', async (req, res) => {
  try {
    const { user_id } = req.body;
    
    if (!req.botId || !req.botConfig) {
      return res.status(400).json({ error: 'Bot identification required' });
    }
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const botId = req.botId;
    const botConfig = req.botConfig;
    
    console.log(`[${botId}] Checking subscription for user: ${user_id}`);
    
    const channelUsername = botConfig.subscription?.channelUsername;
    const requireSubscription = botConfig.features?.requireSubscription;
    
    // Если подписка не требуется
    if (!requireSubscription || !channelUsername) {
      return res.json({ 
        subscribed: true,
        channel: null,
        message: 'Subscription not required'
      });
    }
    
    // Проверяем подписку через Telegram Bot API
    const botToken = botConfig.botToken;
    if (!botToken) {
      console.error(`[${botId}] No bot token configured`);
      return res.json({ subscribed: false });
    }
    
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${botToken}/getChatMember`,
        {
          params: {
            chat_id: channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`,
            user_id: user_id
          },
          timeout: 10000
        }
      );
      
      const status = response.data.result.status;
      const isSubscribed = ['creator', 'administrator', 'member', 'restricted'].includes(status);
      
      console.log(`[${botId}] User ${user_id} subscription status: ${status} (subscribed: ${isSubscribed})`);
      
      res.json({ 
        subscribed: isSubscribed,
        channel: channelUsername,
        status: status
      });
    } catch (error) {
      console.error(`[${botId}] Error checking subscription for user ${user_id}:`, error.response?.data || error.message);
      
      // Если канал не найден или бот не админ, считаем что подписан
      if (error.response?.data?.description?.includes('chat not found') ||
          error.response?.data?.description?.includes('bot is not a member')) {
        console.warn(`[${botId}] Channel issue, assuming subscribed`);
        return res.json({ subscribed: true, channel: channelUsername, warning: 'Channel access issue' });
      }
      
      res.json({ 
        subscribed: false,
        channel: channelUsername,
        error: 'Failed to check subscription'
      });
    }
    
  } catch (error) {
    console.error('Error in /api/check-subscribe:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. Эндпоинт для получения конфигурации колеса
app.get('/api/wheel-config', async (req, res) => {
  try {
    if (!req.botId || !req.botConfig) {
      return res.status(400).json({ error: 'Bot identification required' });
    }
    
    const botId = req.botId;
    const botConfig = req.botConfig;
    
    console.log(`[${botId}] Getting wheel config`);
    
    const prizes = botConfig.wheel?.prizes || [];
    
    // Преобразуем призы в формат для HTML
    const items = prizes
      .filter(prize => prize.isAvailable !== false)
      .map((prize, index) => ({
        id: prize.id || index + 1,
        label: prize.text || `Приз ${index + 1}`,
        win_text: prize.description || prize.text || `Поздравляем! Вы выиграли приз!`,
        value: prize.value || 0,
        probability: prize.probability || (1 / prizes.length),
        type: prize.type || 'points',
        color: prize.color || '#B31414'
      }));
    
    // Если нет призов, создаем дефолтные
    if (items.length === 0) {
      items.push(
        { id: 1, label: '10 баллов', win_text: 'Поздравляем! Вы выиграли 10 баллов!', value: 10, probability: 0.3, type: 'points', color: '#ef4444' },
        { id: 2, label: '20 баллов', win_text: 'Поздравляем! Вы выиграли 20 баллов!', value: 20, probability: 0.25, type: 'points', color: '#f59e0b' },
        { id: 3, label: '30 баллов', win_text: 'Поздравляем! Вы выиграли 30 баллов!', value: 30, probability: 0.2, type: 'points', color: '#10b981' },
        { id: 4, label: '50 баллов', win_text: 'Поздравляем! Вы выиграли 50 баллов!', value: 50, probability: 0.15, type: 'points', color: '#3b82f6' },
        { id: 5, label: '100 баллов', win_text: 'Поздравляем! Вы выиграли 100 баллов!', value: 100, probability: 0.08, type: 'points', color: '#8b5cf6' },
        { id: 6, label: 'Главный приз', win_text: 'Поздравляем! Вы выиграли главный приз!', value: 500, probability: 0.02, type: 'points', color: '#ec4899' }
      );
    }
    
    res.json({
      bot_id: botId,
      bot_name: botConfig.name,
      items,
      spin_duration: botConfig.wheel?.spinDuration || 5,
      rotation_count: botConfig.wheel?.rotationCount || 5,
      total_items: items.length
    });
    
  } catch (error) {
    console.error('Error in /api/wheel-config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. Эндпоинт для вращения колеса
app.post('/api/spin', async (req, res) => {
  try {
    const { user_id, referrer_id, username } = req.body;
    
    if (!req.botId || !req.botConfig) {
      return res.status(400).json({ error: 'Bot identification required' });
    }
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const botId = req.botId;
    const botConfig = req.botConfig;
    
    console.log(`[${botId}] Spin request from user: ${user_id}, referrer: ${referrer_id || 'none'}`);
    
    const botRef = db.collection('bots').doc(botId);
    const userRef = botRef.collection('users').doc(String(user_id));
    
    const [botDoc, userDoc] = await Promise.all([
      botRef.get(),
      userRef.get()
    ]);
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const userData = userDoc.data();
    
    // Проверка дневного лимита
    const today = new Date().toDateString();
    const spinsToday = userData.spins?.filter(spin => {
      if (!spin.date) return false;
      const spinDate = spin.date.toDate ? 
        spin.date.toDate().toDateString() : 
        new Date(spin.date).toDateString();
      return spinDate === today;
    }).length || 0;
    
    const maxSpins = botConfig.limits?.spinsPerDay || 3;
    
    if (spinsToday >= maxSpins) {
      return res.status(400).json({ 
        error: 'Дневной лимит исчерпан',
        attempts_left: 0,
        spins_today: spinsToday
      });
    }
    
    // Проверка кулдауна
    if (userData.lastSpin) {
      const lastSpinTime = userData.lastSpin.toDate ? 
        userData.lastSpin.toDate().getTime() : 
        new Date(userData.lastSpin).getTime();
      const cooldownSeconds = botConfig.limits?.cooldownSeconds || 3600;
      const cooldownEnd = lastSpinTime + (cooldownSeconds * 1000);
      
      if (Date.now() < cooldownEnd) {
        const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
        return res.status(400).json({ 
          error: `Следующий спин через: ${remaining} сек.`,
          cooldown_remaining: remaining
        });
      }
    }
    
    // Обработка реферера
    if (referrer_id && String(referrer_id) !== String(user_id) && !userData.referrer_processed) {
      const referrerRef = botRef.collection('users').doc(String(referrer_id));
      const referrerDoc = await referrerRef.get();
      
      if (referrerDoc.exists) {
        try {
          await referrerRef.update({
            invitedUsers: admin.firestore.FieldValue.arrayUnion(user_id),
            referrals: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          // Даем бонус рефереру (например, дополнительную попытку)
          const referrerUpdate = {};
          const referralReward = botConfig.referral?.rewardType;
          
          if (referralReward === 'extra_spin') {
            // Можно добавить логику для бонусных спинов
            referrerUpdate.referral_bonus_spins = admin.firestore.FieldValue.increment(1);
          }
          
          if (Object.keys(referrerUpdate).length > 0) {
            await referrerRef.update(referrerUpdate);
          }
          
          // Отмечаем, что реферер обработан
          await userRef.update({
            referrer_processed: true,
            referrer_id: referrer_id,
            referred_by: referrer_id
          });
          
          console.log(`[${botId}] User ${user_id} referred by ${referrer_id}`);
        } catch (error) {
          console.error(`[${botId}] Error processing referrer:`, error);
        }
      }
    }
    
    // Выбор приза на основе вероятности
    const availablePrizes = (botConfig.wheel?.prizes || []).filter(p => p.isAvailable !== false);
    if (availablePrizes.length === 0) {
      return res.status(400).json({ error: 'Нет доступных призов' });
    }
    
    const totalProbability = availablePrizes.reduce((sum, p) => sum + (p.probability || 0), 0);
    let random = Math.random() * totalProbability;
    let selectedPrize = availablePrizes[0];
    
    for (const prize of availablePrizes) {
      if (random < (prize.probability || 0)) {
        selectedPrize = prize;
        break;
      }
      random -= (prize.probability || 0);
    }
    
    // Генерация уникального ID спина
    const spin_id = `spin_${Date.now()}_${user_id}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Подготовка записи спина
    const spinRecord = {
      spin_id,
      user_id: String(user_id),
      prize_id: selectedPrize.id,
      prize_text: selectedPrize.text,
      prize_value: selectedPrize.value,
      prize_type: selectedPrize.type,
      date: admin.firestore.FieldValue.serverTimestamp(),
      claimed: false,
      bot_id: botId
    };
    
    // Транзакция для сохранения спина
    await db.runTransaction(async (transaction) => {
      // Обновляем данные пользователя
      transaction.update(userRef, {
        spins: admin.firestore.FieldValue.arrayUnion(spinRecord),
        totalSpins: admin.firestore.FieldValue.increment(1),
        lastSpin: admin.firestore.FieldValue.serverTimestamp(),
        [`dailyStats.${today}.spins`]: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Обновляем статистику бота
      transaction.update(botRef, {
        totalSpins: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    
    // Если приз не "none" типа, сохраняем его отдельно
    if (selectedPrize.type !== 'none') {
      const prizeRecord = {
        ...spinRecord,
        claimDate: null,
        expiryDate: new Date(Date.now() + ((botConfig.limits?.prizeExpiryDays || 7) * 24 * 60 * 60 * 1000)),
        status: 'won'
      };
      
      await userRef.update({
        prizes: admin.firestore.FieldValue.arrayUnion(prizeRecord),
        totalPrizes: admin.firestore.FieldValue.increment(1)
      });
      
      await botRef.update({
        totalPrizes: admin.firestore.FieldValue.increment(1)
      });
      
      // Отправляем уведомление в Telegram
      const botToken = botConfig.botToken;
      if (botToken && botConfig.notifications?.prizeWon) {
        try {
          await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: user_id,
            text: `🎉 *Поздравляем!*\n\nВы выиграли: *${selectedPrize.text}*\n\nПриз будет действителен до ${new Date(Date.now() + ((botConfig.limits?.prizeExpiryDays || 7) * 24 * 60 * 60 * 1000)).toLocaleDateString('ru-RU')}\n\nID приза: ${spin_id}`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '🎡 Крутить еще', callback_data: 'spin_again' }
              ]]
            }
          });
        } catch (error) {
          console.error(`[${botId}] Error sending Telegram notification:`, error.message);
        }
      }
    }
    
    const newAttemptsLeft = Math.max(0, maxSpins - (spinsToday + 1));
    
    res.json({
      success: true,
      bot_id: botId,
      spin_id,
      prize: selectedPrize.text,
      prize_type: selectedPrize.type,
      prize_value: selectedPrize.value,
      attempts_left: newAttemptsLeft,
      spins_today: spinsToday + 1,
      total_spins: (userData.totalSpins || 0) + 1,
      cooldown: botConfig.limits?.cooldownSeconds || 3600,
      expiry_days: botConfig.limits?.prizeExpiryDays || 7
    });
    
  } catch (error) {
    console.error('Error in /api/spin:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// 5. Эндпоинт для отправки лида (контактных данных)
app.post('/api/submit-lead', async (req, res) => {
  try {
    const { user_id, spin_id, name, phone } = req.body;
    
    if (!req.botId || !req.botConfig) {
      return res.status(400).json({ error: 'Bot identification required' });
    }
    
    if (!user_id || !spin_id) {
      return res.status(400).json({ error: 'user_id and spin_id are required' });
    }
    
    const botId = req.botId;
    const botConfig = req.botConfig;
    
    console.log(`[${botId}] Lead submission from user: ${user_id} for spin: ${spin_id}`);
    
    const botRef = db.collection('bots').doc(botId);
    const userRef = botRef.collection('users').doc(String(user_id));
    
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const userData = userDoc.data();
    
    // Находим спин и обновляем его
    const updatedSpins = userData.spins?.map(spin => {
      if (spin.spin_id === spin_id) {
        return {
          ...spin,
          lead_submitted: true,
          lead_data: { 
            name: name || '', 
            phone: phone || '',
            submitted_at: new Date().toISOString(),
            ip: req.ip,
            user_agent: req.headers['user-agent']
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
      }
      return spin;
    });
    
    // Обновляем контактные данные пользователя
    const updateData = {
      spins: updatedSpins || userData.spins,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (name) updateData.fullName = name;
    if (phone) updateData.phone = phone;
    
    await userRef.update(updateData);
    
    // Отправляем лид в Telegram (если настроен канал для лидов)
    const leadsTargetId = botConfig.telegram?.leadsTargetId;
    const botToken = botConfig.botToken;
    
    if (leadsTargetId && botToken) {
      try {
        const prizeText = userData.spins?.find(s => s.spin_id === spin_id)?.prize_text || 'неизвестно';
        
        const message = `📋 *Новый лид!*\n\n` +
          `🤖 Бот: ${botConfig.name}\n` +
          `👤 Пользователь: ${req.body.username ? '@' + req.body.username : 'без username'}\n` +
          `🆔 User ID: ${user_id}\n` +
          `📛 Имя: ${name || 'не указано'}\n` +
          `📱 Телефон: ${phone || 'не указан'}\n` +
          `🎁 Выигранный приз: ${prizeText}\n` +
          `🕐 Время: ${new Date().toLocaleString('ru-RU')}\n` +
          `🔗 ID спина: ${spin_id}`;
        
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: leadsTargetId,
          text: message,
          parse_mode: 'Markdown'
        });
        
        console.log(`[${botId}] Lead sent to Telegram channel ${leadsTargetId}`);
      } catch (error) {
        console.error(`[${botId}] Error sending lead to Telegram:`, error.message);
      }
    }
    
    // Сохраняем лид в отдельную коллекцию для аналитики
    try {
      const leadsRef = db.collection('leads');
      await leadsRef.add({
        bot_id: botId,
        user_id: String(user_id),
        spin_id: spin_id,
        name: name || '',
        phone: phone || '',
        prize: userData.spins?.find(s => s.spin_id === spin_id)?.prize_text,
        ip: req.ip,
        user_agent: req.headers['user-agent'],
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        source: 'wheel_form'
      });
    } catch (error) {
      console.error(`[${botId}] Error saving lead to analytics:`, error);
    }
    
    res.json({ 
      success: true, 
      message: 'Данные успешно сохранены',
      bot_id: botId
    });
    
  } catch (error) {
    console.error('Error in /api/submit-lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 6. Фолбэк для лида (если пользователь не заполнил форму)
app.post('/api/lead-fallback', async (req, res) => {
  try {
    const { user_id, spin_id } = req.body;
    
    if (!req.botId || !req.botConfig) {
      return res.status(400).json({ error: 'Bot identification required' });
    }
    
    if (!user_id || !spin_id) {
      return res.status(400).json({ error: 'user_id and spin_id are required' });
    }
    
    const botId = req.botId;
    
    console.log(`[${botId}] Lead fallback for user: ${user_id}, spin: ${spin_id}`);
    
    const userRef = db.collection('bots').doc(botId).collection('users').doc(String(user_id));
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      const updatedSpins = userData.spins?.map(spin => {
        if (spin.spin_id === spin_id) {
          return {
            ...spin,
            lead_fallback: true,
            fallback_time: new Date().toISOString(),
            fallback_reason: 'timeout'
          };
        }
        return spin;
      });
      
      await userRef.update({
        spins: updatedSpins || userData.spins,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`[${botId}] Fallback applied for spin ${spin_id}`);
    }
    
    res.json({ 
      success: true, 
      message: 'Фолбэк применен',
      bot_id: botId
    });
    
  } catch (error) {
    console.error('Error in /api/lead-fallback:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 7. Получение статистики бота
app.get('/api/bot-stats', async (req, res) => {
  try {
    if (!req.botId || !req.botConfig) {
      return res.status(400).json({ error: 'Bot identification required' });
    }
    
    const botId = req.botId;
    
    console.log(`[${botId}] Getting bot statistics`);
    
    const botRef = db.collection('bots').doc(botId);
    const botDoc = await botRef.get();
    
    if (!botDoc.exists) {
      return res.status(404).json({ error: 'Бот не найден' });
    }
    
    // Получаем всех пользователей бота
    const usersSnapshot = await botRef.collection('users').get();
    const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Статистика за сегодня
    const today = new Date().toDateString();
    let todaySpins = 0;
    let todayUsers = 0;
    const todayUsersSet = new Set();
    
    users.forEach(user => {
      const spinsToday = user.spins?.filter(spin => {
        if (!spin.date) return false;
        const spinDate = spin.date.toDate ? 
          spin.date.toDate().toDateString() : 
          new Date(spin.date).toDateString();
        return spinDate === today;
      }).length || 0;
      
      todaySpins += spinsToday;
      if (spinsToday > 0) {
        todayUsersSet.add(user.id);
      }
    });
    
    todayUsers = todayUsersSet.size;
    
    // Общая статистика
    const stats = {
      bot_id: botId,
      total_users: users.length,
      total_spins: users.reduce((sum, user) => sum + (user.totalSpins || 0), 0),
      total_prizes: users.reduce((sum, user) => sum + (user.totalPrizes || 0), 0),
      today_spins: todaySpins,
      today_users: todayUsers,
      referrals: users.reduce((sum, user) => sum + (user.invitedUsers?.length || 0), 0),
      avg_spins_per_user: users.length > 0 ? 
        (users.reduce((sum, user) => sum + (user.totalSpins || 0), 0) / users.length).toFixed(2) : 0,
      top_users: users
        .sort((a, b) => (b.totalSpins || 0) - (a.totalSpins || 0))
        .slice(0, 5)
        .map(user => ({
          id: user.userId,
          username: user.username,
          spins: user.totalSpins || 0,
          prizes: user.totalPrizes || 0
        }))
    };
    
    res.json(stats);
    
  } catch (error) {
    console.error('Error in /api/bot-stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 8. Эндпоинт для получения информации о боте
app.get('/api/bot-info', async (req, res) => {
  try {
    if (!req.botId || !req.botConfig) {
      return res.status(400).json({ error: 'Bot identification required' });
    }
    
    const botConfig = req.botConfig;
    
    // Возвращаем только публичную информацию о боте
    res.json({
      bot_id: req.botId,
      name: botConfig.name,
      bot_username: botConfig.botUsername,
      branding: botConfig.branding,
      texts: botConfig.texts,
      features: botConfig.features,
      limits: botConfig.limits,
      wheel: {
        prizes_count: botConfig.wheel?.prizes?.length || 0,
        spin_duration: botConfig.wheel?.spinDuration || 5
      },
      subscription: botConfig.subscription ? {
        channel_username: botConfig.subscription.channelUsername,
        required: botConfig.features?.requireSubscription || false
      } : null,
      referral: botConfig.referral ? {
        enabled: botConfig.referral.enabled,
        reward_text: botConfig.referral.rewardText
      } : null
    });
    
  } catch (error) {
    console.error('Error in /api/bot-info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 9. Webhook для Telegram бота (опционально)
app.post(`/webhook/:botId`, async (req, res) => {
  try {
    const botId = req.params.botId;
    const update = req.body;
    
    console.log(`[${botId}] Webhook received:`, update.update_id);
    
    // Здесь можно обрабатывать сообщения от пользователей
    
    res.send('OK');
  } catch (error) {
    console.error('Error in webhook:', error);
    res.status(500).send('Error');
  }
});

// 10. Обслуживание статических файлов для каждого бота
// Путь для общего статического контента
app.use(express.static(path.join(__dirname, 'public')));

// Динамические пути для каждого бота
app.use('/bot/:botId', async (req, res, next) => {
  try {
    const botId = req.params.botId;
    
    // Проверяем существование бота
    const botConfig = await getBotConfig(botId);
    if (!botConfig) {
      return res.status(404).send('Bot not found');
    }
    
    // Проксируем запрос к статическим файлам бота
    req.url = `/bots/${botId}${req.url}`;
    next();
  } catch (error) {
    console.error('Error serving bot static files:', error);
    res.status(500).send('Internal server error');
  }
});

// 11. Рендеринг HTML для бота по ID
app.get('/bot/:botId/app', async (req, res) => {
  try {
    const botId = req.params.botId;
    
    const botConfig = await getBotConfig(botId);
    if (!botConfig) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Bot Not Found</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .error { color: #ff4444; }
            </style>
          </head>
          <body>
            <h1 class="error">Bot Not Found</h1>
            <p>Bot with ID "${botId}" does not exist or is not configured.</p>
          </body>
        </html>
      `);
    }
    
    // Здесь можно генерировать HTML на лету или отдавать готовый файл
    // Для простоты отдаем JSON с конфигурацией
    res.json({
      message: `Bot "${botConfig.name}" configuration`,
      bot_id: botId,
      name: botConfig.name,
      app_url: `https://t.me/${botConfig.botUsername}/app`
    });
    
  } catch (error) {
    console.error('Error rendering bot app:', error);
    res.status(500).send('Internal server error');
  }
});

// 12. Главная страница с информацией о ботах
app.get('/', async (req, res) => {
  try {
    // Получаем список всех ботов
    const botsSnapshot = await db.collection('bots').get();
    const bots = botsSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      username: doc.data().botUsername,
      status: doc.data().status || 'active'
    }));
    
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Telegram Mini Apps Server</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              max-width: 800px; 
              margin: 0 auto; 
              padding: 20px; 
              line-height: 1.6;
              background: #f5f5f5;
            }
            .header { 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 40px;
              border-radius: 10px;
              text-align: center;
              margin-bottom: 30px;
            }
            .bot-card {
              background: white;
              border-radius: 8px;
              padding: 20px;
              margin-bottom: 20px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .bot-name {
              font-size: 18px;
              font-weight: bold;
              margin-bottom: 5px;
              color: #333;
            }
            .bot-username {
              color: #666;
              margin-bottom: 10px;
            }
            .bot-link {
              display: inline-block;
              background: #4CAF50;
              color: white;
              padding: 8px 16px;
              border-radius: 4px;
              text-decoration: none;
              margin-right: 10px;
            }
            .status {
              display: inline-block;
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              font-weight: bold;
            }
            .status-active { background: #4CAF50; color: white; }
            .status-inactive { background: #ff9800; color: white; }
            .api-info {
              background: white;
              border-radius: 8px;
              padding: 20px;
              margin-top: 30px;
            }
            code {
              background: #f5f5f5;
              padding: 2px 4px;
              border-radius: 3px;
              font-family: monospace;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🚀 Telegram Mini Apps Server</h1>
            <p>Multi-bot backend for Wheel of Fortune games</p>
            <p>Total bots: ${bots.length}</p>
          </div>
          
          <h2>Available Bots</h2>
          ${bots.length === 0 ? 
            '<p>No bots configured yet.</p>' : 
            bots.map(bot => `
              <div class="bot-card">
                <div class="bot-name">${bot.name}</div>
                <div class="bot-username">@${bot.username}</div>
                <span class="status status-${bot.status}">${bot.status}</span>
                <div style="margin-top: 10px;">
                  <a href="/bot/${bot.id}/app" class="bot-link">App Page</a>
                  <a href="/api/bot-info?bot_id=${bot.id}" class="bot-link">API Info</a>
                  <a href="/api/bot-stats?bot_id=${bot.id}" class="bot-link">Statistics</a>
                </div>
              </div>
            `).join('')
          }
          
          <div class="api-info">
            <h2>📡 API Endpoints</h2>
            <ul>
              <li><code>POST /api/status?bot_id={bot_id}</code> - User status</li>
              <li><code>POST /api/check-subscribe?bot_id={bot_id}</code> - Subscription check</li>
              <li><code>GET /api/wheel-config?bot_id={bot_id}</code> - Wheel configuration</li>
              <li><code>POST /api/spin?bot_id={bot_id}</code> - Spin wheel</li>
              <li><code>POST /api/submit-lead?bot_id={bot_id}</code> - Submit contact form</li>
              <li><code>GET /api/bot-stats?bot_id={bot_id}</code> - Bot statistics</li>
              <li><code>GET /api/bot-info?bot_id={bot_id}</code> - Bot information</li>
            </ul>
            <p>Bot can be identified via: query parameter, subdomain, or path prefix</p>
          </div>
          
          <div style="text-align: center; margin-top: 40px; color: #666; font-size: 14px;">
            <p>Server running on port ${process.env.PORT || 3000}</p>
            <p>Firebase: ${firebaseInitialized ? '✅ Connected' : '❌ Disconnected'}</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error rendering main page:', error);
    res.status(500).send('Internal server error');
  }
});

// Обработка 404 ошибок
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    method: req.method,
    available_endpoints: [
      'GET /',
      'GET /health',
      'POST /api/status',
      'POST /api/check-subscribe',
      'GET /api/wheel-config',
      'POST /api/spin',
      'POST /api/submit-lead',
      'GET /api/bot-stats',
      'GET /api/bot-info',
      'GET /bot/:botId/app'
    ]
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`
  🚀 Server started successfully!
  
  🔗 Local: http://localhost:${PORT}
  🌐 Network: http://${HOST}:${PORT}
  
  📊 Health check: http://localhost:${PORT}/health
  📝 Main page: http://localhost:${PORT}/
  
  🤖 Available identification methods:
    1. Subdomain: https://bot1.localhost:${PORT}
    2. Path: http://localhost:${PORT}/bot/bot1/app
    3. Query: http://localhost:${PORT}/api/status?bot_id=bot1
    4. Header: X-Bot-ID: bot1
  
  ⚡ Firebase: ${firebaseInitialized ? '✅ Connected' : '❌ Failed'}
  💾 Cache: ${botConfigCache.size} bots loaded
  
  Environment: ${process.env.NODE_ENV || 'development'}
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;
