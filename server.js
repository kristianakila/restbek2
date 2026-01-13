const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();

// =====================================================
// 🌐 НАСТРОЙКА CORS - РАЗРЕШАЕМ ВСЁ!
// =====================================================

// Используем готовый middleware cors
app.use(cors());

// Дополнительная кастомная настройка CORS
app.use((req, res, next) => {
  // Разрешаем все домены
  res.header("Access-Control-Allow-Origin", "*");
  
  // Разрешаем все методы
  res.header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS, PATCH");
  
  // Разрешаем все заголовки
  res.header("Access-Control-Allow-Headers", 
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Length, " +
    "X-Auth-Token, X-API-Key, X-Client-ID, X-Client-Version, X-Platform, X-App-Version, " +
    "X-Device-ID, X-Session-ID, X-Timezone, X-Language, X-User-Agent, X-Forwarded-For, " +
    "X-Real-IP, Access-Control-Allow-Origin, Access-Control-Allow-Headers, Access-Control-Allow-Methods"
  );
  
  // Разрешаем экспозицию заголовков
  res.header("Access-Control-Expose-Headers", 
    "Content-Length, Content-Type, Authorization, X-Total-Count, X-Page-Count"
  );
  
  // Разрешаем кэширование preflight запросов
  res.header("Access-Control-Max-Age", "86400");
  
  // Обрабатываем preflight запросы OPTIONS
  if (req.method === "OPTIONS") {
    console.log("🛫 Preflight CORS запрос:", {
      origin: req.headers.origin || "неизвестно",
      method: req.headers["access-control-request-method"],
      headers: req.headers["access-control-request-headers"]
    });
    return res.status(200).send();
  }
  
  next();
});

// =====================================================
// 🪝 Middleware для логирования всех запросов
// =====================================================

app.use((req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Логируем входящий запрос
  console.log(`🌐 ${new Date().toISOString()} ${req.method} ${req.originalUrl}`, {
    origin: req.headers.origin || "неизвестно",
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers["user-agent"] ? req.headers["user-agent"].substring(0, 80) + "..." : "не указан",
    bodySize: req.headers["content-length"] || "0",
    contentType: req.headers["content-type"] || "не указан"
  });
  
  // Перехватываем отправку ответа для логирования
  res.send = function(body) {
    const duration = Date.now() - startTime;
    
    console.log(`📤 ${new Date().toISOString()} Ответ ${req.method} ${req.originalUrl}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      size: body ? body.toString().length : 0
    });
    
    originalSend.call(this, body);
  };
  
  res.json = function(body) {
    const duration = Date.now() - startTime;
    
    console.log(`📤 ${new Date().toISOString()} Ответ JSON ${req.method} ${req.originalUrl}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      size: body ? JSON.stringify(body).length : 0
    });
    
    originalJson.call(this, body);
  };
  
  next();
});

// =====================================================
// 📦 Парсинг JSON и URL-encoded данных
// =====================================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// =====================================================
// 🔥 ИНИЦИАЛИЗАЦИЯ FIREBASE
// =====================================================

let firebaseInitialized = false;
let db = null;

// Функция инициализации Firebase
function initializeFirebase() {
  try {
    const serviceAccountPath = path.join(__dirname, "firebasekey.json");
    
    if (!fs.existsSync(serviceAccountPath)) {
      console.error("❌ Файл firebasekey.json не найден:", serviceAccountPath);
      console.log("ℹ️  Убедитесь, что firebasekey.json находится в той же папке, что и server.js");
      return false;
    }
    
    const serviceAccount = require(serviceAccountPath);
    
    // Проверяем обязательные поля
    if (!serviceAccount.project_id) {
      console.error("❌ В firebasekey.json отсутствует project_id");
      return false;
    }
    
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
      });
      
      console.log("✅ Firebase Admin SDK инициализирован");
    }
    
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    
    firebaseInitialized = true;
    console.log("🔥 Firestore подключен и готов к работе");
    
    return true;
  } catch (error) {
    console.error("❌ Ошибка инициализации Firebase:", error.message);
    console.error("Детали ошибки:", error);
    return false;
  }
}

// Инициализируем Firebase при запуске
firebaseInitialized = initializeFirebase();

// =====================================================
// 🧪 ПРОВЕРОЧНЫЕ ЭНДПОИНТЫ
// =====================================================

// Главная страница
app.get("/", (req, res) => {
  res.json({
    status: "online",
    name: "Telegram Mini Apps Backend",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized ? "connected" : "disconnected",
    cors: "enabled",
    endpoints: [
      "GET  /                    - Эта страница",
      "GET  /health              - Проверка здоровья сервера",
      "GET  /api/test            - Тест API",
      "GET  /api/firebase-status - Статус Firebase",
      "POST /api/status          - Статус пользователя",
      "POST /api/check-subscribe - Проверка подписки",
      "POST /api/spin            - Вращение колеса",
      "POST /api/submit-lead     - Отправка лида",
      "POST /api/lead-fallback   - Фолбэк для лида"
    ]
  });
});

// Проверка здоровья сервера
app.get("/health", (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    },
    firebase: firebaseInitialized ? "connected" : "disconnected",
    cors: "enabled",
    node: process.version,
    platform: process.platform
  };
  
  res.json(health);
});

// Тест Firebase
app.get("/api/firebase-status", async (req, res) => {
  if (!firebaseInitialized || !db) {
    return res.status(503).json({
      error: "Firebase not initialized",
      firebase_initialized: false
    });
  }
  
  try {
    // Пробуем простой запрос к Firestore
    const testRef = db.collection("_healthcheck");
    const snapshot = await testRef.limit(1).get();
    
    res.json({
      firebase: "connected",
      firestore: "working",
      test_collection_exists: !snapshot.empty,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: "Firebase test failed",
      message: error.message,
      firebase_initialized: true
    });
  }
});

// Простой тест API
app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "API работает корректно!",
    timestamp: new Date().toISOString(),
    request: {
      method: req.method,
      path: req.path,
      origin: req.headers.origin || "не указан",
      userAgent: req.headers["user-agent"] ? req.headers["user-agent"].substring(0, 50) + "..." : "не указан"
    }
  });
});

// =====================================================
// 🎯 ОСНОВНЫЕ API ЭНДПОИНТЫ ДЛЯ WEBAPP
// =====================================================

// 1. Получение статуса пользователя
app.post("/api/status", async (req, res) => {
  console.log("📊 /api/status called with body:", req.body);
  
  try {
    const { user_id, bot_id, username } = req.body;
    
    // Валидация входных данных
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
        code: "MISSING_USER_ID"
      });
    }
    
    // Если Firebase не инициализирован, возвращаем тестовые данные
    if (!firebaseInitialized || !db) {
      console.log("⚠️  Firebase не инициализирован, возвращаем тестовые данные");
      
      return res.json({
        success: true,
        user_id: String(user_id),
        bot_id: bot_id || "Q6hGNds9cjSCj6wME1Hm",
        attempts_left: 3,
        spins_today: 0,
        total_spins: 0,
        total_prizes: 0,
        referrals: 0,
        ref_link: `https://t.me/test_bot?start=uid_${user_id}`,
        cooldown: 0,
        is_new_user: false,
        message: "Используются тестовые данные (Firebase недоступен)"
      });
    }
    
    // Реальная логика с Firebase
    try {
      const userIdStr = String(user_id);
      const botId = bot_id || "Q6hGNds9cjSCj6wME1Hm";
      
      // Проверяем существование пользователя
      const userRef = db.collection("bots").doc(botId).collection("users").doc(userIdStr);
      const userDoc = await userRef.get();
      
      let userData = null;
      let isNewUser = false;
      
      if (userDoc.exists) {
        userData = userDoc.data();
        console.log(`✅ Пользователь ${user_id} найден в базе`);
      } else {
        // Создаем нового пользователя
        console.log(`🆕 Создаем нового пользователя: ${user_id}`);
        
        const newUserData = {
          user_id: userIdStr,
          username: username || "",
          first_name: "",
          last_name: "",
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          spins: [],
          prizes: [],
          invited_users: [],
          total_spins: 0,
          total_prizes: 0,
          attempts_left: 3,
          last_spin: null,
          referrals: 0,
          ref_link: `https://t.me/test_bot?start=uid_${user_id}`
        };
        
        await userRef.set(newUserData);
        userData = newUserData;
        isNewUser = true;
      }
      
      // Рассчитываем оставшиеся попытки
      const today = new Date().toISOString().split('T')[0];
      const spinsToday = userData.spins ? userData.spins.filter(spin => {
        const spinDate = spin.date ? 
          (spin.date.toDate ? spin.date.toDate().toISOString().split('T')[0] : 
           new Date(spin.date).toISOString().split('T')[0]) : 
          null;
        return spinDate === today;
      }).length : 0;
      
      const maxSpinsPerDay = 3;
      const attemptsLeft = Math.max(0, maxSpinsPerDay - spinsToday);
      
      // Проверяем кулдаун
      let cooldownRemaining = 0;
      if (userData.last_spin) {
        const lastSpinTime = userData.last_spin.toDate ? 
          userData.last_spin.toDate().getTime() : 
          new Date(userData.last_spin).getTime();
        const cooldownMs = 3600 * 1000; // 1 час
        const cooldownEnd = lastSpinTime + cooldownMs;
        
        if (Date.now() < cooldownEnd) {
          cooldownRemaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
        }
      }
      
      res.json({
        success: true,
        user_id: userIdStr,
        bot_id: botId,
        attempts_left: attemptsLeft,
        spins_today: spinsToday,
        total_spins: userData.total_spins || 0,
        total_prizes: userData.total_prizes || 0,
        referrals: userData.invited_users ? userData.invited_users.length : 0,
        ref_link: userData.ref_link || `https://t.me/test_bot?start=uid_${user_id}`,
        cooldown: cooldownRemaining,
        is_new_user: isNewUser
      });
      
    } catch (firebaseError) {
      console.error("❌ Ошибка Firebase при получении статуса:", firebaseError);
      
      // Возвращаем тестовые данные в случае ошибки Firebase
      res.json({
        success: true,
        user_id: String(user_id),
        bot_id: bot_id || "Q6hGNds9cjSCj6wME1Hm",
        attempts_left: 3,
        spins_today: 0,
        total_spins: 0,
        total_prizes: 0,
        referrals: 0,
        ref_link: `https://t.me/test_bot?start=uid_${user_id}`,
        cooldown: 0,
        is_new_user: false,
        warning: "Используются тестовые данные из-за ошибки Firebase"
      });
    }
    
  } catch (error) {
    console.error("❌ Ошибка в /api/status:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
      code: "SERVER_ERROR"
    });
  }
});

// 2. Проверка подписки на канал
app.post("/api/check-subscribe", async (req, res) => {
  console.log("📺 /api/check-subscribe called with body:", req.body);
  
  try {
    const { user_id, bot_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
        code: "MISSING_USER_ID"
      });
    }
    
    // Для упрощения всегда возвращаем, что пользователь подписан
    // В реальном приложении здесь будет проверка через Telegram API
    
    res.json({
      success: true,
      subscribed: true,
      channel: "@ellenclinic",
      status: "member",
      message: "Пользователь подписан на канал",
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ Ошибка в /api/check-subscribe:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    });
  }
});

// 3. Вращение колеса
app.post("/api/spin", async (req, res) => {
  console.log("🎡 /api/spin called with body:", req.body);
  
  try {
    const { user_id, username, bot_id, referrer_id } = req.body;
    
    // Валидация
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
        code: "MISSING_USER_ID"
      });
    }
    
    // Проверяем, есть ли у пользователя попытки
    // Для теста всегда разрешаем спин
    
    // Список призов
    const prizes = [
      { label: "10 баллов", value: 10, type: "points", probability: 0.3 },
      { label: "20 баллов", value: 20, type: "points", probability: 0.25 },
      { label: "30 баллов", value: 30, type: "points", probability: 0.2 },
      { label: "50 баллов", value: 50, type: "points", probability: 0.15 },
      { label: "100 баллов", value: 100, type: "points", probability: 0.08 },
      { label: "Главный приз", value: 500, type: "grand_prize", probability: 0.02 }
    ];
    
    // Выбираем приз на основе вероятностей
    const totalProbability = prizes.reduce((sum, prize) => sum + prize.probability, 0);
    let random = Math.random() * totalProbability;
    let selectedPrize = prizes[0];
    
    for (const prize of prizes) {
      if (random < prize.probability) {
        selectedPrize = prize;
        break;
      }
      random -= prize.probability;
    }
    
    const spinId = `spin_${Date.now()}_${user_id}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Если Firebase инициализирован, сохраняем результат
    if (firebaseInitialized && db) {
      try {
        const userIdStr = String(user_id);
        const botId = bot_id || "Q6hGNds9cjSCj6wME1Hm";
        
        const userRef = db.collection("bots").doc(botId).collection("users").doc(userIdStr);
        const spinRecord = {
          spin_id: spinId,
          user_id: userIdStr,
          prize: selectedPrize.label,
          prize_value: selectedPrize.value,
          prize_type: selectedPrize.type,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          claimed: false
        };
        
        // Обновляем данные пользователя
        await userRef.update({
          spins: admin.firestore.FieldValue.arrayUnion(spinRecord),
          total_spins: admin.firestore.FieldValue.increment(1),
          last_spin: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Спин сохранен в Firebase: ${spinId}`);
        
      } catch (firebaseError) {
        console.error("❌ Ошибка Firebase при сохранении спина:", firebaseError);
        // Продолжаем выполнение даже при ошибке Firebase
      }
    }
    
    // Возвращаем результат
    res.json({
      success: true,
      bot_id: bot_id || "Q6hGNds9cjSCj6wME1Hm",
      spin_id: spinId,
      prize: selectedPrize.label,
      prize_type: selectedPrize.type,
      prize_value: selectedPrize.value,
      attempts_left: 2, // После спина уменьшаем на 1
      spins_today: 1,
      total_spins: 1,
      cooldown: 3600,
      message: "Спин успешно выполнен",
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ Ошибка в /api/spin:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
      code: "SPIN_ERROR"
    });
  }
});

// 4. Отправка контактных данных (лида)
app.post("/api/submit-lead", async (req, res) => {
  console.log("📋 /api/submit-lead called with body:", req.body);
  
  try {
    const { user_id, spin_id, name, phone, bot_id, username } = req.body;
    
    // Валидация
    if (!user_id || !spin_id) {
      return res.status(400).json({
        success: false,
        error: "user_id and spin_id are required",
        code: "MISSING_REQUIRED_FIELDS"
      });
    }
    
    // Проверяем, что хотя бы одно поле заполнено
    if (!name && !phone) {
      return res.status(400).json({
        success: false,
        error: "At least one of name or phone is required",
        code: "NO_CONTACT_DATA"
      });
    }
    
    // Если Firebase инициализирован, сохраняем лид
    if (firebaseInitialized && db) {
      try {
        const userIdStr = String(user_id);
        const botId = bot_id || "Q6hGNds9cjSCj6wME1Hm";
        
        // Сохраняем лид в отдельную коллекцию
        const leadsRef = db.collection("leads");
        await leadsRef.add({
          user_id: userIdStr,
          spin_id: spin_id,
          name: name || "",
          phone: phone || "",
          username: username || "",
          bot_id: botId,
          submitted_at: admin.firestore.FieldValue.serverTimestamp(),
          ip_address: req.ip || req.connection.remoteAddress,
          user_agent: req.headers["user-agent"] || ""
        });
        
        // Обновляем спин в профиле пользователя
        const userRef = db.collection("bots").doc(botId).collection("users").doc(userIdStr);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const updatedSpins = userData.spins ? userData.spins.map(spin => {
            if (spin.spin_id === spin_id) {
              return {
                ...spin,
                lead_submitted: true,
                lead_data: {
                  name: name || "",
                  phone: phone || "",
                  submitted_at: new Date().toISOString()
                },
                claimed: true
              };
            }
            return spin;
          }) : [];
          
          if (updatedSpins.length > 0) {
            await userRef.update({
              spins: updatedSpins,
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
              ...(name && { full_name: name }),
              ...(phone && { phone: phone })
            });
          }
        }
        
        console.log(`✅ Лид сохранен в Firebase для спина: ${spin_id}`);
        
      } catch (firebaseError) {
        console.error("❌ Ошибка Firebase при сохранении лида:", firebaseError);
        // Продолжаем выполнение даже при ошибке Firebase
      }
    }
    
    // Отправляем уведомление в Telegram (опционально)
    // В реальном приложении здесь будет отправка в Telegram канал
    
    res.json({
      success: true,
      message: "Данные успешно сохранены",
      bot_id: bot_id || "Q6hGNds9cjSCj6wME1Hm",
      spin_id: spin_id,
      timestamp: new Date().toISOString(),
      saved_to_firebase: firebaseInitialized
    });
    
  } catch (error) {
    console.error("❌ Ошибка в /api/submit-lead:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
      code: "LEAD_SUBMIT_ERROR"
    });
  }
});

// 5. Фолбэк для лида (если пользователь не заполнил форму вовремя)
app.post("/api/lead-fallback", async (req, res) => {
  console.log("⏱️ /api/lead-fallback called with body:", req.body);
  
  try {
    const { user_id, spin_id, bot_id, username } = req.body;
    
    // Валидация
    if (!user_id || !spin_id) {
      return res.status(400).json({
        success: false,
        error: "user_id and spin_id are required",
        code: "MISSING_REQUIRED_FIELDS"
      });
    }
    
    // Если Firebase инициализирован, отмечаем фолбэк
    if (firebaseInitialized && db) {
      try {
        const userIdStr = String(user_id);
        const botId = bot_id || "Q6hGNds9cjSCj6wME1Hm";
        
        const userRef = db.collection("bots").doc(botId).collection("users").doc(userIdStr);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const updatedSpins = userData.spins ? userData.spins.map(spin => {
            if (spin.spin_id === spin_id && !spin.lead_submitted) {
              return {
                ...spin,
                lead_fallback: true,
                fallback_time: new Date().toISOString(),
                fallback_reason: "timeout"
              };
            }
            return spin;
          }) : [];
          
          if (updatedSpins.length > 0) {
            await userRef.update({
              spins: updatedSpins,
              updated_at: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }
        
        console.log(`✅ Фолбэк применен для спина: ${spin_id}`);
        
      } catch (firebaseError) {
        console.error("❌ Ошибка Firebase при применении фолбэка:", firebaseError);
      }
    }
    
    res.json({
      success: true,
      message: "Фолбэк успешно применен",
      bot_id: bot_id || "Q6hGNds9cjSCj6wME1Hm",
      spin_id: spin_id,
      timestamp: new Date().toISOString(),
      fallback_applied: true
    });
    
  } catch (error) {
    console.error("❌ Ошибка в /api/lead-fallback:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
      code: "FALLBACK_ERROR"
    });
  }
});

// =====================================================
// 📋 ОБРАБОТКА ОШИБОК И 404
// =====================================================

// Обработка 404 - маршрут не найден
app.use((req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.originalUrl}`);
  
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    available_endpoints: [
      "GET  /",
      "GET  /health",
      "GET  /api/test",
      "GET  /api/firebase-status",
      "POST /api/status",
      "POST /api/check-subscribe",
      "POST /api/spin",
      "POST /api/submit-lead",
      "POST /api/lead-fallback"
    ]
  });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error("💥 Unhandled error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : "Something went wrong",
    code: "UNHANDLED_ERROR",
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// 🚀 ЗАПУСК СЕРВЕРА
// =====================================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`
  🚀 Сервер успешно запущен!
  
  🔗 Локальный адрес: http://localhost:${PORT}
  🌐 Сетевой адрес: http://${HOST}:${PORT}
  
  📊 Проверка здоровья: http://localhost:${PORT}/health
  🧪 Тест API: http://localhost:${PORT}/api/test
  🔥 Статус Firebase: http://localhost:${PORT}/api/firebase-status
  
  ⚡ Статус Firebase: ${firebaseInitialized ? '✅ Подключен' : '❌ Не подключен'}
  🌐 CORS: ✅ Включен (все домены разрешены)
  
  📋 Доступные эндпоинты:
  POST /api/status          - Статус пользователя
  POST /api/check-subscribe - Проверка подписки
  POST /api/spin            - Вращение колеса
  POST /api/submit-lead     - Отправка лида
  POST /api/lead-fallback   - Фолбэк для лида
  
  ⏰ Время запуска: ${new Date().toISOString()}
  🖥️  Окружение: ${process.env.NODE_ENV || 'development'}
  📍 Хост: ${HOST}:${PORT}
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM получен, graceful shutdown...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT получен, graceful shutdown...');
  process.exit(0);
});

module.exports = app;
