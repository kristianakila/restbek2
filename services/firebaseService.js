// services/firebaseService.js - полный исправленный файл

const admin = require("firebase-admin");

let firebaseApp = null;
let firestore = null;
let firebaseInitialized = false;

/**
 * Инициализация Firebase
 */
function initializeFirebase() {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      console.log("⚠️ FIREBASE_SERVICE_ACCOUNT_KEY не установлен, Firebase отключен");
      return false;
    }

    if (firebaseApp) {
      console.log("✅ Firebase уже инициализирован");
      return true;
    }

    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    firestore = admin.firestore();
    
    // Настройки Firestore
    firestore.settings({
      ignoreUndefinedProperties: true
    });

    console.log("✅ Firebase успешно инициализирован");
    firebaseInitialized = true;
    return true;
  } catch (error) {
    console.error("❌ Ошибка инициализации Firebase:", error.message);
    firebaseInitialized = false;
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
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, возвращаем null");
      return null;
    }

    const docRef = firestore.collection("bots").doc(botId);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.log(`❌ Конфигурация бота ${botId} не найдена`);
      return null;
    }

    return doc.data();
  } catch (error) {
    console.error(`❌ Ошибка получения конфигурации бота ${botId}:`, error.message);
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

    return userDoc.data();
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
      is_active: true
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
 * Сохранение спина пользователя (ИСПРАВЛЕННАЯ ФУНКЦИЯ)
 */
async function saveSpin(botId, userId, spinData) {
  try {
    if (!firestore) {
      console.log("⚠️ Firestore не инициализирован, пропускаем сохранение спина");
      return `mock_spin_${Date.now()}_${userId}`;
    }

    const userRef = firestore
      .collection("bots")
      .doc(botId)
      .collection("users")
      .doc(String(userId));

    // Создаём объект спина с обычной датой
    const spinId = `spin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const spin = {
      spin_id: spinId,
      prize: spinData.prize || {},
      timestamp: new Date().toISOString(), // Используем ISO строку вместо FieldValue.serverTimestamp()
      claimed: false,
      lead_submitted: false
    };

    // Получаем текущие данные пользователя
    const userDoc = await userRef.get();
    let currentSpins = [];
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      currentSpins = userData.spins || [];
    }

    // Добавляем новый спин
    currentSpins.push(spin);

    // Обновляем документ пользователя
    await userRef.update({
      spins: currentSpins, // Просто присваиваем новый массив
      last_spin: admin.firestore.FieldValue.serverTimestamp(),
      total_spins: admin.firestore.FieldValue.increment(1)
    });

    console.log(`✅ Спин сохранён для ${userId}, ID: ${spinId}`);
    return spinId;
  } catch (error) {
    console.error(`❌ Ошибка сохранения спина для ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Сохранение лида (НОВАЯ ФУНКЦИЯ)
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
      processed: false
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
      total_prizes: admin.firestore.FieldValue.increment(1)
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
          fallback_reason: "timeout"
        };
      }
      return spin;
    });

    await userRef.update({
      spins: updatedSpins
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
  saveLead, // Добавлена эта функция
  updateSpinLead,
  updateSpinFallback,
  getBotLeads
};
