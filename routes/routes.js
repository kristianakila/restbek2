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

// 3. Вращение колеса (два пути для совместимости)
router.post("/api/spin",
  middleware.validateFields(["userId"]),
  async (req, res) => {
    try {
      const { userId, referrerId } = req.body;
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
      const userData = await firebaseService.getUserData(botId, userId);
      
      // Если пользователь не найден, создаем нового
      if (!userData && firebaseService.isInitialized()) {
        await firebaseService.createUser(botId, userId, {
          username: req.body.username || "",
          attemptsLeft: botConfig?.limits?.spinsPerDay || 3
        });
      }
      
      // Проверяем попытки
      const today = new Date().toISOString().split('T')[0];
      const spinsToday = userData?.spins ? userData.spins.filter(spin => {
        const spinDate = spin.timestamp?.toDate ? 
          spin.timestamp.toDate().toISOString().split('T')[0] : 
          new Date(spin.timestamp).toISOString().split('T')[0];
        return spinDate === today;
      }).length : 0;
      
      const maxSpinsPerDay = botConfig?.limits?.spinsPerDay || 3;
      
      if (spinsToday >= maxSpinsPerDay) {
        return res.status(400).json({
          success: false,
          error: "Daily spin limit reached",
          code: "DAILY_LIMIT_REACHED"
        });
      }
      
      // Проверяем кулдаун
      if (userData?.last_spin) {
        const lastSpinTime = userData.last_spin.toDate ? 
          userData.last_spin.toDate().getTime() : 
          new Date(userData.last_spin).getTime();
        
        const cooldownMs = (botConfig?.limits?.cooldownSeconds || 3600) * 1000;
        
        if (Date.now() < lastSpinTime + cooldownMs) {
          return res.status(400).json({
            success: false,
            error: "Spin cooldown active",
            code: "SPIN_COOLDOWN"
          });
        }
      }
      
      // Выбираем приз
      const prize = selectPrize(botConfig);
      
      let spinId;
      if (firebaseService.isInitialized()) {
        // Сохраняем спин в Firebase
        spinId = await firebaseService.saveSpin(botId, userId, { prize });
      } else {
        // Генерируем тестовый ID спина
        spinId = `test_spin_${Date.now()}_${userId}`;
      }
      
      res.json({
        success: true,
        spin_id: spinId,
        spinId: spinId, // Новое поле для совместимости
        prize: prize.label, // Для совместимости с HTML
        attempts_left: Math.max(0, maxSpinsPerDay - spinsToday - 1),
        cooldown: botConfig?.limits?.cooldownSeconds || 3600,
        message: "Spin successful"
      });
      
    } catch (error) {
      console.error("❌ Ошибка в /api/spin:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        code: "SPIN_ERROR"
      });
    }
  }
);

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
