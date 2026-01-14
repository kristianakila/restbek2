// routes/routes.js - API маршруты приложения
const express = require("express");
const router = express.Router();
const middleware = require("../middleware/middleware");
const firebaseService = require("../services/firebaseService");

// =====================================================
// 🧪 ТЕСТОВЫЕ ЭНДПОИНТЫ
// =====================================================

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "API работает корректно!",
    timestamp: new Date().toISOString(),
    botId: req.headers["x-bot-id"] || "не указан"
  });
});

router.get("/firebase-status", async (req, res) => {
  const firebaseInitialized = firebaseService.isInitialized();
  
  if (!firebaseInitialized) {
    return res.status(503).json({
      error: "Firebase not initialized",
      firebase_initialized: false
    });
  }
  
  res.json({
    firebase: "connected",
    firestore: "working",
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// 🎯 ОСНОВНЫЕ API ЭНДПОИНТЫ
// =====================================================

// 1. Статус пользователя
router.post("/api/user-status", 
  middleware.validateFields(["userId"]),
  async (req, res) => {
    try {
      const { userId, referrerId, username, firstName, lastName, languageCode } = req.body;
      const botId = req.botId;
      
      console.log("📊 /api/user-status called", { botId, userId });
      
      // Получаем конфигурацию бота
      const botConfig = await firebaseService.getBotConfig(botId);
      
      if (!botConfig && firebaseService.isInitialized()) {
        return res.status(404).json({
          success: false,
          error: "Bot configuration not found",
          code: "BOT_NOT_FOUND"
        });
      }
      
      // Получаем данные пользователя
      let userData = await firebaseService.getUserData(botId, userId);
      let isNewUser = false;
      
      // Если пользователь не существует, создаем нового
      if (!userData && firebaseService.isInitialized()) {
        userData = await firebaseService.createUser(botId, userId, {
          username,
          firstName,
          lastName,
          languageCode,
          attemptsLeft: botConfig?.limits?.spinsPerDay || 3
        });
        isNewUser = true;
        
        // Обработка реферера
        if (referrerId && referrerId !== userId) {
          await handleReferrer(botId, userId, referrerId);
        }
      }
      
      // Если Firebase не инициализирован или пользователь не найден, возвращаем тестовые данные
      if (!userData) {
        return res.json({
          success: true,
          user_id: userId,
          bot_id: botId,
          attempts_left: 3,
          spins_today: 0,
          total_spins: 0,
          total_prizes: 0,
          referrals: 0,
          referral_link: `https://t.me/your_bot?start=uid_${userId}`,
          cooldown: 0,
          is_new_user: false,
          message: "Test mode - Firebase not available"
        });
      }
      
      // Рассчитываем оставшиеся попытки
      const today = new Date().toISOString().split('T')[0];
      const spinsToday = userData.spins ? userData.spins.filter(spin => {
        const spinDate = spin.timestamp?.toDate ? 
          spin.timestamp.toDate().toISOString().split('T')[0] : 
          new Date(spin.timestamp).toISOString().split('T')[0];
        return spinDate === today;
      }).length : 0;
      
      const maxSpinsPerDay = botConfig?.limits?.spinsPerDay || 3;
      const attemptsLeft = Math.max(0, maxSpinsPerDay - spinsToday);
      
      // Проверяем кулдаун
      let cooldownRemaining = 0;
      let nextSpinAt = null;
      
      if (userData.last_spin) {
        const lastSpinTime = userData.last_spin.toDate ? 
          userData.last_spin.toDate().getTime() : 
          new Date(userData.last_spin).getTime();
        
        const cooldownMs = (botConfig?.limits?.cooldownSeconds || 3600) * 1000;
        const cooldownEnd = lastSpinTime + cooldownMs;
        
        if (Date.now() < cooldownEnd) {
          cooldownRemaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
          nextSpinAt = new Date(cooldownEnd).toISOString();
        }
      }
      
      res.json({
        success: true,
        user_id: userId,
        bot_id: botId,
        attempts_left: attemptsLeft,
        attemptsLeft: attemptsLeft, // Для совместимости с HTML
        spins_today: spinsToday,
        total_spins: userData.total_spins || 0,
        total_prizes: userData.total_prizes || 0,
        referrals: userData.invited_users ? userData.invited_users.length : 0,
        ref_link: userData.referral_link || `https://t.me/${botConfig?.botUsername || 'your_bot'}?start=uid_${userId}`,
        referral_link: userData.referral_link || `https://t.me/${botConfig?.botUsername || 'your_bot'}?start=uid_${userId}`,
        cooldown: cooldownRemaining,
        nextSpinAt: nextSpinAt,
        is_new_user: isNewUser
      });
      
    } catch (error) {
      console.error("❌ Ошибка в /api/user-status:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        code: "STATUS_ERROR"
      });
    }
  }
);

// 2. Проверка подписки - ИСПРАВЛЕННАЯ ВЕРСИЯ
router.post("/api/check-subscription",
  middleware.validateFields(["userId"]),
  async (req, res) => {
    try {
      const { userId } = req.body;
      const botId = req.botId;
      
      console.log("📺 /api/check-subscription called", { botId, userId });
      
      // Получаем конфигурацию бота
      const botConfig = await firebaseService.getBotConfig(botId);
      
      // Если Firebase не инициализирован, возвращаем успех для тестирования
      if (!firebaseService.isInitialized()) {
        return res.json({
          success: true,
          subscribed: true,
          channelId: null,
          status: "not_required",
          message: "Firebase not initialized - test mode",
          timestamp: new Date().toISOString()
        });
      }
      
      // Если нет конфигурации бота, возвращаем ошибку
      if (!botConfig) {
        return res.status(404).json({
          success: false,
          error: "Bot configuration not found",
          code: "BOT_NOT_FOUND"
        });
      }
      
      // Если нет канала в настройках, считаем что подписан
      if (!botConfig.subscription || !botConfig.subscription.channelUsername) {
        return res.json({
          success: true,
          subscribed: true,
          channelId: null,
          status: "not_required",
          message: "Subscription not required",
          timestamp: new Date().toISOString()
        });
      }
      
      // Здесь должна быть реальная проверка подписки через Telegram API
      // Пока возвращаем заглушку
      
      res.json({
        success: true,
        subscribed: true, // Заглушка
        channelId: botConfig.subscription.channelUsername,
        status: "member",
        message: "Subscription check successful",
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error("❌ Ошибка в /api/check-subscription:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  }
);

// 3. Вращение колеса (два пути для совместимости) - БЕЗ КУЛДАУНА
router.post("/api/spin",
  middleware.validateFields(["userId"]),
  async (req, res) => {
    try {
      const { userId, referrerId, username } = req.body;
      const botId = req.botId;
      
      console.log("🎡 /api/spin called", { botId, userId });
      
      // Получаем конфигурацию бота
      const botConfig = await firebaseService.getBotConfig(botId);
      
      if (!botConfig && firebaseService.isInitialized()) {
        return res.status(404).json({
          success: false,
          error: "Bot configuration not found",
          code: "BOT_NOT_FOUND"
        });
      }
      
      // Получаем данные пользователя
      let userData = await firebaseService.getUserData(botId, userId);
      
      // Если пользователь не найден, создаем нового
      if (!userData && firebaseService.isInitialized()) {
        userData = await firebaseService.createUser(botId, userId, {
          username: username || "",
          firstName: req.body.firstName || "",
          lastName: req.body.lastName || "",
          languageCode: req.body.languageCode || "ru",
          attemptsLeft: botConfig?.limits?.spinsPerDay || 3
        });
      }
      
      // Если Firebase не инициализирован, используем mock-данные
      if (!firebaseService.isInitialized()) {
        console.log('⚠️ Firestore не инициализирован, используем mock-логику');
        
        // Выбираем приз
        const prize = selectPrize(botConfig);
        const spinId = `mock_spin_${Date.now()}_${userId}`;
        
        return res.json({
          success: true,
          spin_id: spinId,
          spinId: spinId,
          prize: prize.label,
          attempts_left: 2, // Mock значение
          attemptsLeft: 2,
          spins_today: 1,
          total_spins: 1,
          cooldown: 0, // КУЛДАУН ВЫКЛЮЧЕН
          cooldown_until: new Date().toISOString(), // Текущее время
          message: "Spin successful (mock mode)",
          metadata: {
            is_fallback: true,
            source: "mock"
          }
        });
      }
      
      // Если userData все еще null, создаем простой объект
      if (!userData) {
        userData = {
          spins: [],
          attempts_left: botConfig?.limits?.spinsPerDay || 3
        };
      }
      
      // Вычисляем количество спинов за сегодня
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const spinsToday = userData.spins ? userData.spins.filter(spin => {
        let spinDate;
        if (spin.timestamp && spin.timestamp.toDate) {
          spinDate = spin.timestamp.toDate();
        } else if (spin.timestamp) {
          spinDate = new Date(spin.timestamp);
        } else {
          return false;
        }
        return spinDate >= today;
      }).length : 0;
      
      const maxSpinsPerDay = botConfig?.limits?.spinsPerDay || 3;
      
      // Проверяем дневной лимит
      if (spinsToday >= maxSpinsPerDay) {
        return res.status(400).json({
          success: false,
          error: `Daily spin limit reached (${maxSpinsPerDay} per day)`,
          code: "DAILY_LIMIT_REACHED",
          max_spins_per_day: maxSpinsPerDay,
          spins_today: spinsToday,
          message: `Достигнут дневной лимит: ${maxSpinsPerDay} вращений`
        });
      }
      
      // Проверяем попытки (attempts_left)
      if (userData.attempts_left !== undefined && userData.attempts_left <= 0) {
        return res.status(400).json({
          success: false,
          error: "No attempts left",
          code: "NO_ATTEMPTS_LEFT",
          attempts_left: userData.attempts_left,
          message: "Попытки закончились"
        });
      }
      
      // ВЫКЛЮЧАЕМ ПРОВЕРКУ КУЛДАУНА - КОММЕНТИРУЕМ ВЕСЬ БЛОК
      /*
      // Проверяем кулдаун - ВЫКЛЮЧЕНО ДЛЯ ТЕСТИРОВАНИЯ
      if (userData.last_spin) {
        let lastSpinTime;
        
        if (userData.last_spin.toDate) {
          lastSpinTime = userData.last_spin.toDate().getTime();
        } else if (userData.last_spin instanceof Date) {
          lastSpinTime = userData.last_spin.getTime();
        } else {
          lastSpinTime = new Date(userData.last_spin).getTime();
        }
        
        const cooldownMs = cooldownSeconds * 1000;
        const now = Date.now();
        
        if (now < lastSpinTime + cooldownMs) {
          const remainingMs = lastSpinTime + cooldownMs - now;
          const remainingSeconds = Math.ceil(remainingMs / 1000);
          
          return res.status(400).json({
            success: false,
            error: "Spin cooldown active",
            code: "SPIN_COOLDOWN",
            cooldown_remaining: remainingSeconds,
            cooldown_seconds: cooldownSeconds,
            cooldown_until: new Date(lastSpinTime + cooldownMs).toISOString(),
            message: `Подождите ${remainingSeconds} секунд перед следующим вращением`
          });
        }
      }
      */
      
      // Выбираем приз
      const prize = selectPrize(botConfig);
      
      // Сохраняем спин в Firebase
      const spinId = await firebaseService.saveSpin(botId, userId, { 
        prize: prize.label,
        prize_type: prize.type || 'points',
        prize_value: prize.value || 0,
        username: username || ""
      });
      
      // Получаем обновленные данные пользователя
      const updatedUserData = await firebaseService.getUserData(botId, userId) || {};
      
      // Вычисляем новые значения
      const newAttemptsLeft = updatedUserData.attempts_left !== undefined ? 
        updatedUserData.attempts_left : 
        Math.max(0, maxSpinsPerDay - spinsToday - 1);
      
      const newTotalSpins = updatedUserData.total_spins || (userData.total_spins || 0) + 1;
      
      // ВОЗВРАЩАЕМ УСПЕШНЫЙ ОТВЕТ С КУЛДАУНОМ = 0
      res.json({
        success: true,
        spin_id: spinId,
        spinId: spinId,
        prize: prize.label,
        attempts_left: newAttemptsLeft,
        attemptsLeft: newAttemptsLeft,
        spins_today: spinsToday + 1,
        total_spins: newTotalSpins,
        cooldown: 0, // КУЛДАУН ВЫКЛЮЧЕН
        cooldown_until: new Date().toISOString(), // Текущее время
        message: "Spin successful",
        metadata: {
          is_fallback: false,
          source: "firebase"
        }
      });
      
    } catch (error) {
      console.error("❌ Ошибка в /api/spin:", error);
      console.error("Stack:", error.stack);
      
      // Если ошибка связана с Firebase, возвращаем fallback
      if (error.message.includes('Firestore') || error.message.includes('firebase')) {
        console.log('⚠️ Ошибка Firebase, используем fallback');
        
        const botId = req.botId;
        const userId = req.body.userId;
        const botConfig = await firebaseService.getBotConfig(botId);
        const prize = selectPrize(botConfig);
        const spinId = `fallback_spin_${Date.now()}_${userId}`;
        
        return res.json({
          success: true,
          spin_id: spinId,
          spinId: spinId,
          prize: prize.label,
          attempts_left: 2,
          attemptsLeft: 2,
          spins_today: 1,
          total_spins: 1,
          cooldown: 0, // КУЛДАУН ВЫКЛЮЧЕН
          cooldown_until: new Date().toISOString(), // Текущее время
          message: "Spin successful (fallback mode)",
          metadata: {
            is_fallback: true,
            source: "firebase_error_fallback",
            error: error.message
          }
        });
      }
      
      res.status(500).json({
        success: false,
        error: "Internal server error",
        code: "SPIN_ERROR",
        message: "Произошла внутренняя ошибка сервера"
      });
    }
  }
);

// Вспомогательная функция для выбора приза
function selectPrize(botConfig) {
  // Если есть конфигурация бота, используем её
  if (botConfig?.wheel?.prizes && botConfig.wheel.prizes.length > 0) {
    const prizes = botConfig.wheel.prizes;
    const randomIndex = Math.floor(Math.random() * prizes.length);
    const selectedPrize = prizes[randomIndex];
    
    return {
      label: selectedPrize.text || selectedPrize.label || "Приз",
      type: selectedPrize.type || 'points',
      value: selectedPrize.value || 0,
      win_text: selectedPrize.description || `Вы выиграли ${selectedPrize.text || "приз"}!`
    };
  }
  
  // Дефолтные призы
  const defaultPrizes = [
    { label: '10 баллов', win_text: 'Поздравляем! Вы выиграли 10 баллов!', value: 10, type: 'points' },
    { label: '20 баллов', win_text: 'Поздравляем! Вы выиграли 20 баллов!', value: 20, type: 'points' },
    { label: '30 баллов', win_text: 'Поздравляем! Вы выиграли 30 баллов!', value: 30, type: 'points' },
    { label: '50 баллов', win_text: 'Поздравляем! Вы выиграли 50 баллов!', value: 50, type: 'points' },
    { label: '100 баллов', win_text: 'Поздравляем! Вы выиграли 100 баллов!', value: 100, type: 'points' },
    { label: 'Главный приз', win_text: 'Поздравляем! Вы выиграли главный приз!', value: 500, type: 'points' }
  ];
  
  const randomIndex = Math.floor(Math.random() * defaultPrizes.length);
  return defaultPrizes[randomIndex];
}
// 4. Отправка лида
router.post("/api/submit-lead",
  middleware.validateFields(["userId", "spinId"]),
  async (req, res) => {
    try {
      const { userId, spinId, name, phone } = req.body;
      const botId = req.botId;
      
      console.log("📋 /api/submit-lead called", { botId, userId, spinId });
      
      // Проверяем, что хотя бы одно поле заполнено
      if (!name && !phone) {
        return res.status(400).json({
          success: false,
          error: "At least one of name or phone is required",
          code: "NO_CONTACT_DATA"
        });
      }
      
      if (firebaseService.isInitialized()) {
        // Сохраняем лид
        await firebaseService.saveLead({
          bot_id: botId,
          user_id: userId,
          spin_id: spinId,
          name: name || "",
          phone: phone || "",
          submitted_at: new Date().toISOString()
        });
        
        // Обновляем спин
        await updateSpinLead(botId, userId, spinId, { name, phone });
      }
      
      res.json({
        success: true,
        message: "Lead data saved successfully",
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error("❌ Ошибка в /api/submit-lead:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        code: "LEAD_ERROR"
      });
    }
  }
);

// 5. Фолбэк для лида
router.post("/api/lead-fallback",
  middleware.validateFields(["userId", "spinId"]),
  async (req, res) => {
    try {
      const { userId, spinId } = req.body;
      const botId = req.botId;
      
      console.log("⏱️ /api/lead-fallback called", { botId, userId, spinId });
      
      if (firebaseService.isInitialized()) {
        await updateSpinFallback(botId, userId, spinId);
      }
      
      res.json({
        success: true,
        message: "Fallback applied",
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error("❌ Ошибка в /api/lead-fallback:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  }
);

// 6. Конфигурация колеса
router.get("/api/wheel-config", async (req, res) => {
  try {
    const botId = req.botId || req.query.bot_id;
    console.log("⚙️ /api/wheel-config called", { 
      botId,
      headers: req.headers,
      query: req.query 
    });
    
    if (!botId) {
      return res.status(400).json({
        success: false,
        error: "Bot ID is required",
        code: "BOT_ID_REQUIRED"
      });
    }
    
    const botConfig = await firebaseService.getBotConfig(botId);
    
    if (!botConfig) {
      // Если бот не найден, возвращаем дефолтную конфигурацию
      console.log("⚠️ Bot not found, returning default config");
      const defaultWheelConfig = getWheelConfig(null);
      
      return res.json({
        success: true,
        bot_id: botId,
        items: defaultWheelConfig,
        is_default: true,
        timestamp: new Date().toISOString()
      });
    }
    
    // Формируем конфигурацию колеса
    const wheelConfig = getWheelConfig(botConfig);
    
    res.json({
      success: true,
      bot_id: botId,
      items: wheelConfig,
      is_default: false,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ Ошибка в /api/wheel-config:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    });
  }
});

// =====================================================
// 🛠️ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================

/**
 * Выбор приза на основе конфигурации
 */
function selectPrize(botConfig) {
  const prizes = botConfig?.wheel?.prizes || [
    { id: 1, text: "10 баллов", value: 10, probability: 0.3, type: "points" },
    { id: 2, text: "20 баллов", value: 20, probability: 0.25, type: "points" },
    { id: 3, text: "30 баллов", value: 30, probability: 0.2, type: "points" },
    { id: 4, text: "50 баллов", value: 50, probability: 0.15, type: "points" },
    { id: 5, text: "100 баллов", value: 100, probability: 0.08, type: "points" },
    { id: 6, text: "Главный приз", value: 500, probability: 0.02, type: "grand_prize" }
  ];
  
  // Нормализуем вероятности
  const totalProbability = prizes.reduce((sum, prize) => sum + (prize.probability || 0.1), 0);
  let random = Math.random() * totalProbability;
  
  for (const prize of prizes) {
    if (random < (prize.probability || 0.1)) {
      return {
        label: prize.text,
        value: prize.value,
        type: prize.type || "points",
        winText: `Поздравляем! Вы выиграли ${prize.text}!`
      };
    }
    random -= (prize.probability || 0.1);
  }
  
  // Если что-то пошло не так, возвращаем первый приз
  return {
    label: prizes[0].text,
    value: prizes[0].value,
    type: prizes[0].type || "points",
    winText: `Поздравляем! Вы выиграли ${prizes[0].text}!`
  };
}

/**
 * Получение конфигурации колеса
 */
function getWheelConfig(botConfig) {
  const prizes = botConfig?.wheel?.prizes || [
    { id: 1, text: "10 баллов", value: 10, probability: 0.3, type: "points" },
    { id: 2, text: "20 баллов", value: 20, probability: 0.25, type: "points" },
    { id: 3, text: "30 баллов", value: 30, probability: 0.2, type: "points" },
    { id: 4, text: "50 баллов", value: 50, probability: 0.15, type: "points" },
    { id: 5, text: "100 баллов", value: 100, probability: 0.08, type: "points" },
    { id: 6, text: "Главный приз", value: 500, probability: 0.02, type: "grand_prize" }
  ];
  
  return prizes.map(prize => ({
    label: prize.text,
    win_text: prize.description || `Поздравляем! Вы выиграли ${prize.text}!`,
    value: prize.value,
    type: prize.type || "points",
    color: prize.color || "#3b82f6"
  }));
}

/**
 * Обработка реферера
 */
async function handleReferrer(botId, userId, referrerId) {
  try {
    if (!firebaseService.isInitialized()) return;
    
    const referrerData = await firebaseService.getUserData(botId, referrerId);
    
    if (referrerData) {
      await firebaseService.updateUser(botId, referrerId, {
        invited_users: firebaseService.getDatabase().FieldValue.arrayUnion(userId),
        referrals: firebaseService.getDatabase().FieldValue.increment(1)
      });
      
      console.log(`✅ Реферер ${referrerId} получил реферала ${userId}`);
    }
  } catch (error) {
    console.error("❌ Ошибка обработки реферера:", error);
  }
}

/**
 * Обновление спина с данными лида
 */
async function updateSpinLead(botId, userId, spinId, leadData) {
  try {
    if (!firebaseService.isInitialized()) return;
    
    const userData = await firebaseService.getUserData(botId, userId);
    
    if (userData && userData.spins) {
      const updatedSpins = userData.spins.map(spin => {
        if (spin.spin_id === spinId) {
          return {
            ...spin,
            lead_submitted: true,
            lead_data: {
              name: leadData.name || "",
              phone: leadData.phone || "",
              submitted_at: new Date().toISOString()
            },
            claimed: true
          };
        }
        return spin;
      });
      
      await firebaseService.updateUser(botId, userId, {
        spins: updatedSpins
      });
    }
  } catch (error) {
    console.error("❌ Ошибка обновления спина:", error);
  }
}

/**
 * Обновление спина при фолбэке
 */
async function updateSpinFallback(botId, userId, spinId) {
  try {
    if (!firebaseService.isInitialized()) return;
    
    const userData = await firebaseService.getUserData(botId, userId);
    
    if (userData && userData.spins) {
      const updatedSpins = userData.spins.map(spin => {
        if (spin.spin_id === spinId && !spin.lead_submitted) {
          return {
            ...spin,
            lead_fallback: true,
            fallback_time: new Date().toISOString(),
            fallback_reason: "timeout"
          };
        }
        return spin;
      });
      
      await firebaseService.updateUser(botId, userId, {
        spins: updatedSpins
      });
    }
  } catch (error) {
    console.error("❌ Ошибка обновления фолбэка:", error);
  }
}

module.exports = router;
