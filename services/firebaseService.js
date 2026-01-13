// services/firebaseService.js - Сервис для работы с Firebase
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

let db = null;
let firebaseInitialized = false;

/**
 * Инициализация Firebase
 * @returns {boolean} Успешна ли инициализация
 */
function initializeFirebase() {
  try {
    const serviceAccountPath = path.join(__dirname, "..", "firebasekey.json");
    
    if (!fs.existsSync(serviceAccountPath)) {
      console.error("❌ Файл firebasekey.json не найден:", serviceAccountPath);
      return false;
    }
    
    const serviceAccount = require(serviceAccountPath);
    
    if (!serviceAccount.project_id) {
      console.error("❌ В firebasekey.json отсутствует project_id");
      return false;
    }
    
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      
      console.log("✅ Firebase Admin SDK инициализирован");
    }
    
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    
    firebaseInitialized = true;
    console.log("🔥 Firestore подключен");
    
    return true;
  } catch (error) {
    console.error("❌ Ошибка инициализации Firebase:", error.message);
    return false;
  }
}

/**
 * Получение экземпляра базы данных
 * @returns {Object|null} Экземпляр Firestore
 */
function getDatabase() {
  return db;
}

/**
 * Проверка инициализации Firebase
 * @returns {boolean} Статус инициализации
 */
function isInitialized() {
  return firebaseInitialized;
}

/**
 * Получение конфигурации бота
 * @param {string} botId - ID бота
 * @returns {Promise<Object|null>} Конфигурация бота
 */
async function getBotConfig(botId) {
  if (!firebaseInitialized || !db) {
    console.log("⚠️ Firebase не инициализирован");
    return null;
  }
  
  try {
    const botRef = db.collection("bots").doc(botId);
    const botDoc = await botRef.get();
    
    if (!botDoc.exists) {
      console.log(`❌ Бот ${botId} не найден в Firebase`);
      return null;
    }
    
    return botDoc.data();
  } catch (error) {
    console.error(`❌ Ошибка получения конфигурации бота ${botId}:`, error.message);
    return null;
  }
}

/**
 * Получение данных пользователя
 * @param {string} botId - ID бота
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object|null>} Данные пользователя
 */
async function getUserData(botId, userId) {
  if (!firebaseInitialized || !db) {
    console.log("⚠️ Firebase не инициализирован");
    return null;
  }
  
  try {
    const userRef = db.collection("bots").doc(botId).collection("users").doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return null;
    }
    
    return userDoc.data();
  } catch (error) {
    console.error(`❌ Ошибка получения данных пользователя ${userId}:`, error.message);
    return null;
  }
}

/**
 * Создание нового пользователя
 * @param {string} botId - ID бота
 * @param {string} userId - ID пользователя
 * @param {Object} userData - Данные пользователя
 * @returns {Promise<Object>} Созданные данные пользователя
 */
async function createUser(botId, userId, userData) {
  if (!firebaseInitialized || !db) {
    throw new Error("Firebase не инициализирован");
  }
  
  try {
    const userRef = db.collection("bots").doc(botId).collection("users").doc(userId);
    
    const newUserData = {
      user_id: userId,
      username: userData.username || "",
      first_name: userData.firstName || "",
      last_name: userData.lastName || "",
      language_code: userData.languageCode || "ru",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      spins: [],
      prizes: [],
      invited_users: [],
      total_spins: 0,
      total_prizes: 0,
      attempts_left: userData.attemptsLeft || 3,
      last_spin: null,
      referrals: 0,
      referral_code: `uid_${userId}`,
      referral_link: `https://t.me/your_bot?start=uid_${userId}`
    };
    
    await userRef.set(newUserData);
    return newUserData;
  } catch (error) {
    console.error(`❌ Ошибка создания пользователя ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Обновление данных пользователя
 * @param {string} botId - ID бота
 * @param {string} userId - ID пользователя
 * @param {Object} updates - Обновления
 * @returns {Promise<boolean>} Успешно ли обновление
 */
async function updateUser(botId, userId, updates) {
  if (!firebaseInitialized || !db) {
    console.log("⚠️ Firebase не инициализирован");
    return false;
  }
  
  try {
    const userRef = db.collection("bots").doc(botId).collection("users").doc(userId);
    await userRef.update({
      ...updates,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error(`❌ Ошибка обновления пользователя ${userId}:`, error.message);
    return false;
  }
}

/**
 * Сохранение спина
 * @param {string} botId - ID бота
 * @param {string} userId - ID пользователя
 * @param {Object} spinData - Данные спина
 * @returns {Promise<string>} ID спина
 */
async function saveSpin(botId, userId, spinData) {
  if (!firebaseInitialized || !db) {
    throw new Error("Firebase не инициализирован");
  }
  
  try {
    const userRef = db.collection("bots").doc(botId).collection("users").doc(userId);
    const spinId = `spin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const spinRecord = {
      spin_id: spinId,
      prize_label: spinData.prize.label,
      prize_value: spinData.prize.value,
      prize_type: spinData.prize.type,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      claimed: false,
      lead_submitted: false
    };
    
    await userRef.update({
      spins: admin.firestore.FieldValue.arrayUnion(spinRecord),
      total_spins: admin.firestore.FieldValue.increment(1),
      last_spin: admin.firestore.FieldValue.serverTimestamp(),
      attempts_left: admin.firestore.FieldValue.increment(-1)
    });
    
    return spinId;
  } catch (error) {
    console.error(`❌ Ошибка сохранения спина для ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Сохранение лида
 * @param {Object} leadData - Данные лида
 * @returns {Promise<string>} ID лида
 */
async function saveLead(leadData) {
  if (!firebaseInitialized || !db) {
    throw new Error("Firebase не инициализирован");
  }
  
  try {
    const leadsRef = db.collection("leads");
    const leadDoc = await leadsRef.add({
      ...leadData,
      submitted_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return leadDoc.id;
  } catch (error) {
    console.error("❌ Ошибка сохранения лида:", error.message);
    throw error;
  }
}

module.exports = {
  initializeFirebase,
  getDatabase,
  isInitialized,
  getBotConfig,
  getUserData,
  createUser,
  updateUser,
  saveSpin,
  saveLead
};
