// services/firebaseService.js - исправленная версия
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

let firebaseApp = null;
let firestore = null;
let firebaseInitialized = false;

/**
 * Инициализация Firebase
 * @returns {Promise<boolean>} Успешна ли инициализация
 */
async function initializeFirebase() {  // ДОБАВЬ async здесь!
  try {
    console.log("🔥 Начинаем инициализацию Firebase...");
    
    // Проверяем, инициализирован ли уже Firebase
    if (admin.apps.length > 0) {
      console.log("✅ Firebase уже инициализирован");
      firestore = admin.firestore();
      firebaseInitialized = true;
      return true;
    }

    // Вариант 1: Использовать файл сервисного аккаунта
    const serviceAccountPath = path.join(__dirname, "..", "firebasekey.json");
    
    if (fs.existsSync(serviceAccountPath)) {
      console.log("📁 Найден файл firebasekey.json");
      const serviceAccount = require(serviceAccountPath);
      
      if (!serviceAccount.project_id) {
        console.error("❌ В firebasekey.json отсутствует project_id");
        return false;
      }
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      console.log("✅ Firebase Admin SDK инициализирован из файла");
    } 
    // Вариант 2: Использовать переменные окружения
    else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      console.log("🌐 Используем переменные окружения для Firebase");
      
      const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      };
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.projectId
      });
      console.log("✅ Firebase Admin SDK инициализирован из env");
    }
    else {
      console.error("❌ Не найден firebasekey.json и отсутствуют переменные окружения");
      console.error("   Проверьте наличие файла или установите переменные окружения:");
      console.error("   - FIREBASE_PROJECT_ID");
      console.error("   - FIREBASE_CLIENT_EMAIL");
      console.error("   - FIREBASE_PRIVATE_KEY");
      return false;
    }
    
    // Инициализируем Firestore
    firestore = admin.firestore();
    
    // Настройки Firestore
    firestore.settings({ 
      ignoreUndefinedProperties: true,
      timestampsInSnapshots: true
    });
    
    // Тестовое соединение - УБЕРИТЕ await или сделайте вызов без await
    // Но сначала просто попробуйте подключиться без тестового запроса
    console.log("🔄 Подключаемся к Firestore...");
    
    // Простая проверка подключения
    try {
      // Просто получаем доступ к коллекции, не создавая документ
      await firestore.listCollections();
      console.log("✅ Firestore успешно подключен");
      
      firebaseInitialized = true;
      return true;
    } catch (error) {
      console.error("❌ Ошибка подключения к Firestore:", error.message);
      console.error("Stack:", error.stack);
      return false;
    }
    
  } catch (error) {
    console.error("❌ Ошибка инициализации Firebase:", error.message);
    console.error("Stack:", error.stack);
    return false;
  }
}

/**
 * Проверка инициализации Firebase
 */
function isInitialized() {
  return firebaseInitialized;
}

/**
 * Получение экземпляра Firestore
 */
function getDatabase() {
  return firestore;
}

/**
 * Получение конфигурации бота
 */
async function getBotConfig(botId) {
  try {
    if (!firestore || !firebaseInitialized) {
      console.log("⚠️ Firestore не инициализирован, возвращаем null");
      return null;
    }

    console.log(`🔍 Ищем конфигурацию бота ${botId} в Firestore...`);
    
    const docRef = firestore.collection("bots").doc(botId);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.log(`❌ Конфигурация бота ${botId} не найдена в Firestore`);
      return null;
    }

    const data = doc.data();
    console.log(`✅ Конфигурация бота ${botId} загружена из Firestore`);
    return data;
  } catch (error) {
    console.error(`❌ Ошибка получения конфигурации бота ${botId}:`, error.message);
    console.error("Stack:", error.stack);
    return null;
  }
}

/**
 * Получение данных пользователя
 */
async function getUserData(botId, userId) {
  try {
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, возвращаем null");
      return null;
    }

    const userRef = firestore
      .collection("bots")
      .doc(botId)
      .collection("users")
      .doc(String(userId));

    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log(`⚠️ Пользователь ${userId} не найден в боте ${botId}`);
      return null;
    }

    const data = userDoc.data();
    console.log(`✅ Данные пользователя ${userId} загружены`);
    return data;
  } catch (error) {
    console.error(`❌ Ошибка получения данных пользователя ${userId}:`, error.message);
    return null;
  }
}

/**
 * Создание пользователя
 */
async function createUser(botId, userId, userData) {
  try {
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, пропускаем создание пользователя");
      return null;
    }

    const userRef = firestore
      .collection("bots")
      .doc(botId)
      .collection("users")
      .doc(String(userId));

    // Проверяем, не существует ли уже пользователь
    const existingUser = await userRef.get();
    if (existingUser.exists) {
      console.log(`ℹ️ Пользователь ${userId} уже существует`);
      return existingUser.data();
    }

    const newUser = {
      user_id: String(userId),
      username: userData.username || "",
      first_name: userData.firstName || "",
      last_name: userData.lastName || "",
      language_code: userData.languageCode || "ru",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      last_activity: admin.firestore.FieldValue.serverTimestamp(),
      attempts_left: userData.attemptsLeft || 3,
      total_spins: 0,
      total_prizes: 0,
      spins: [],
      invited_users: [],
      referrals: 0,
      referral_link: `https://t.me/${botId}?start=uid_${userId}`,
      is_active: true,
      bot_id: botId
    };

    await userRef.set(newUser);
    console.log(`✅ Пользователь ${userId} создан в боте ${botId}`);

    return newUser;
  } catch (error) {
    console.error(`❌ Ошибка создания пользователя ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Обновление данных пользователя
 */
async function updateUser(botId, userId, updateData) {
  try {
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, пропускаем обновление");
      return;
    }

    const userRef = firestore
      .collection("bots")
      .doc(botId)
      .collection("users")
      .doc(String(userId));

    await userRef.update({
      ...updateData,
      last_activity: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Данные пользователя ${userId} обновлены`);
  } catch (error) {
    console.error(`❌ Ошибка обновления пользователя ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Сохранение спина пользователя (улучшенная версия)
 */
async function saveSpin(botId, userId, spinData) {
  try {
    if (!firestore || !firebaseInitialized) {
      console.log("⚠️ Firestore не инициализирован, пропускаем сохранение спина");
      return `mock_spin_${Date.now()}_${userId}`;
    }

    const userRef = firestore
      .collection("bots")
      .doc(botId)
      .collection("users")
      .doc(String(userId));

    // Генерируем уникальный ID спина
    const spinId = `spin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Создаем объект спина
    const spin = {
      spin_id: spinId,
      spinId: spinId, // Дублируем для совместимости
      prize: spinData.prize || "Неизвестный приз",
      prize_type: spinData.prize_type || "points",
      prize_value: spinData.prize_value || 0,
      timestamp: new Date().toISOString(), // Используем ISO строку
      created_at: admin.firestore.FieldValue.serverTimestamp(), // Для сортировки
      claimed: false,
      lead_submitted: false,
      bot_id: botId,
      user_id: String(userId),
      metadata: {
        source: "wheel",
        version: "2.0"
      }
    };

    try {
      // Используем транзакцию для атомарности операций
      await firestore.runTransaction(async (transaction) => {
        // Получаем текущие данные пользователя
        const userDoc = await transaction.get(userRef);
        
        if (!userDoc.exists) {
          // Если пользователь не существует, создаем его
          const newUserData = {
            user_id: String(userId),
            username: spinData.username || "",
            first_name: spinData.first_name || "",
            last_name: spinData.last_name || "",
            language_code: spinData.language_code || "ru",
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            last_activity: admin.firestore.FieldValue.serverTimestamp(),
            last_spin: admin.firestore.FieldValue.serverTimestamp(),
            attempts_left: 2, // После первого спина
            attempts_total: 3, // Общее количество попыток
            spins_today: 1,
            total_spins: 1,
            total_prizes: 0,
            spins: [spin],
            referrals: 0,
            referral_link: `https://t.me/${botId}?start=uid_${userId}`,
            ref_link: `https://t.me/${botId}?start=uid_${userId}`, // Для совместимости
            is_active: true,
            bot_id: botId,
            cooldown_until: admin.firestore.FieldValue.serverTimestamp(),
            last_updated: admin.firestore.FieldValue.serverTimestamp()
          };
          
          transaction.set(userRef, newUserData);
        } else {
          // Если пользователь существует, обновляем
          const userData = userDoc.data();
          const currentSpins = userData.spins || [];
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          
          // Считаем спины за сегодня
          let spinsToday = 0;
          if (userData.spins) {
            spinsToday = userData.spins.filter(spinItem => {
              let spinDate;
              if (spinItem.timestamp) {
                spinDate = new Date(spinItem.timestamp);
                spinDate = new Date(spinDate.getFullYear(), spinDate.getMonth(), spinDate.getDate());
              }
              return spinDate && spinDate.getTime() === today.getTime();
            }).length;
          }
          
          // Вычисляем новое количество попыток
          const currentAttempts = userData.attempts_left !== undefined ? userData.attempts_left : 3;
          const newAttemptsLeft = Math.max(0, currentAttempts - 1);
          
          // Обновляем данные
          const updateData = {
            spins: [...currentSpins, spin],
            last_spin: admin.firestore.FieldValue.serverTimestamp(),
            last_activity: admin.firestore.FieldValue.serverTimestamp(),
            total_spins: admin.firestore.FieldValue.increment(1),
            attempts_left: newAttemptsLeft,
            spins_today: spinsToday + 1,
            last_updated: admin.firestore.FieldValue.serverTimestamp(),
            cooldown_until: admin.firestore.Timestamp.fromDate(
              new Date(Date.now() + (30 * 1000)) // 30 секунд кулдаун
            )
          };
          
          // Добавляем поле total_prizes если его нет
          if (userData.total_prizes === undefined) {
            updateData.total_prizes = 0;
          }
          
          transaction.update(userRef, updateData);
        }
      });
      
      console.log(`✅ Спин сохранён для ${userId}, ID: ${spinId}`);
      return spinId;
      
    } catch (transactionError) {
      console.error(`❌ Ошибка транзакции для пользователя ${userId}:`, transactionError.message);
      
      // Пробуем без транзакции (fallback)
      console.log('🔄 Пробуем сохранить спин без транзакции...');
      return await saveSpinWithoutTransaction(botId, userId, spinData, spinId, spin);
    }
    
  } catch (error) {
    console.error(`❌ Критическая ошибка сохранения спина для ${userId}:`, error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

/**
 * Сохранение спина без транзакции (fallback метод)
 */
async function saveSpinWithoutTransaction(botId, userId, spinData, spinId, spin) {
  try {
    const userRef = firestore
      .collection("bots")
      .doc(botId)
      .collection("users")
      .doc(String(userId));

    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      // Создаем нового пользователя
      await userRef.set({
        user_id: String(userId),
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        last_activity: admin.firestore.FieldValue.serverTimestamp(),
        last_spin: admin.firestore.FieldValue.serverTimestamp(),
        attempts_left: 2,
        attempts_total: 3,
        spins_today: 1,
        total_spins: 1,
        total_prizes: 0,
        spins: [spin],
        referrals: 0,
        referral_link: `https://t.me/${botId}?start=uid_${userId}`,
        ref_link: `https://t.me/${botId}?start=uid_${userId}`,
        is_active: true,
        bot_id: botId,
        last_updated: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Обновляем существующего пользователя
      const userData = userDoc.data();
      const currentSpins = userData.spins || [];
      const currentAttempts = userData.attempts_left !== undefined ? userData.attempts_left : 3;
      
      await userRef.update({
        spins: [...currentSpins, spin],
        last_spin: admin.firestore.FieldValue.serverTimestamp(),
        last_activity: admin.firestore.FieldValue.serverTimestamp(),
        total_spins: admin.firestore.FieldValue.increment(1),
        attempts_left: Math.max(0, currentAttempts - 1),
        last_updated: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    console.log(`✅ Спин сохранён (без транзакции) для ${userId}, ID: ${spinId}`);
    return spinId;
    
  } catch (fallbackError) {
    console.error(`❌ Ошибка fallback-сохранения для ${userId}:`, fallbackError.message);
    
    // Возвращаем mock ID в случае полной ошибки
    return `error_spin_${Date.now()}_${userId}`;
  }
}

/**
 * Сохранение лида
 */
async function saveLead(leadData) {
  try {
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, пропускаем сохранение лида");
      return null;
    }

    const leadsRef = firestore.collection("leads");
    const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const lead = {
      lead_id: leadId,
      bot_id: leadData.bot_id,
      user_id: String(leadData.user_id),
      spin_id: leadData.spin_id,
      name: leadData.name || "",
      phone: leadData.phone || "",
      submitted_at: admin.firestore.FieldValue.serverTimestamp(),
      status: "new",
      processed: false,
      source: "wheel"
    };

    await leadsRef.doc(leadId).set(lead);
    console.log(`✅ Лид сохранён для пользователя ${leadData.user_id}, ID: ${leadId}`);

    return leadId;
  } catch (error) {
    console.error(`❌ Ошибка сохранения лида для пользователя ${leadData.user_id}:`, error.message);
    throw error;
  }
}

/**
 * Обновление спина с данными лида
 */
async function updateSpinLead(botId, userId, spinId, leadData) {
  try {
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, пропускаем обновление спина");
      return;
    }

    const userRef = firestore
      .collection("bots")
      .doc(botId)
      .collection("users")
      .doc(String(userId));

    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log(`⚠️ Пользователь ${userId} не найден`);
      return;
    }

    const userData = userDoc.data();
    const updatedSpins = (userData.spins || []).map(spin => {
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

    await userRef.update({
      spins: updatedSpins,
      total_prizes: admin.firestore.FieldValue.increment(1),
      last_activity: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Спин ${spinId} обновлен с данными лида`);
  } catch (error) {
    console.error(`❌ Ошибка обновления спина ${spinId}:`, error.message);
    throw error;
  }
}

/**
 * Обновление спина при фолбэке
 */
async function updateSpinFallback(botId, userId, spinId) {
  try {
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, пропускаем обновление фолбэка");
      return;
    }

    const userRef = firestore
      .collection("bots")
      .doc(botId)
      .collection("users")
      .doc(String(userId));

    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log(`⚠️ Пользователь ${userId} не найден`);
      return;
    }

    const userData = userDoc.data();
    const updatedSpins = (userData.spins || []).map(spin => {
      if (spin.spin_id === spinId && !spin.lead_submitted) {
        return {
          ...spin,
          lead_fallback: true,
          fallback_time: new Date().toISOString(),
          fallback_reason: "timeout",
          claimed: true
        };
      }
      return spin;
    });

    await userRef.update({
      spins: updatedSpins,
      total_prizes: admin.firestore.FieldValue.increment(1),
      last_activity: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Фолбэк применен для спина ${spinId}`);
  } catch (error) {
    console.error(`❌ Ошибка обновления фолбэка для спина ${spinId}:`, error.message);
    throw error;
  }
}

/**
 * Получение всех лидов бота
 */
async function getBotLeads(botId, limit = 100) {
  try {
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, возвращаем пустой массив");
      return [];
    }

    const leadsRef = firestore.collection("leads");
    const snapshot = await leadsRef
      .where("bot_id", "==", botId)
      .orderBy("submitted_at", "desc")
      .limit(limit)
      .get();

    const leads = [];
    snapshot.forEach(doc => {
      leads.push({ id: doc.id, ...doc.data() });
    });

    console.log(`✅ Получено ${leads.length} лидов для бота ${botId}`);
    return leads;
  } catch (error) {
    console.error(`❌ Ошибка получения лидов для бота ${botId}:`, error.message);
    return [];
  }
}

module.exports = {
  initializeFirebase,
  isInitialized,
  getDatabase,
  getBotConfig,
  getUserData,
  createUser,
  updateUser,
  saveSpin,
  saveLead,
  updateSpinLead,
  updateSpinFallback,
  getBotLeads
};
