// middleware/middleware.js - Middleware для обработки запросов

/**
 * Логирование входящих запросов
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  console.log(`🌐 ${new Date().toISOString()} ${req.method} ${req.path}`, {
    origin: req.headers.origin || "не указан",
    ip: req.ip,
    userAgent: req.headers["user-agent"] ? req.headers["user-agent"].substring(0, 100) : "не указан",
    botId: req.headers["x-bot-id"] || "не указан"
  });
  
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - startTime;
    
    console.log(`📤 ${new Date().toISOString()} Ответ ${req.method} ${req.path}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
    
    originalSend.call(this, body);
  };
  
  next();
}

/**
 * Валидация Bot ID
 */
function botIdValidator(req, res, next) {
  const botId = req.headers["x-bot-id"];
  
  if (!botId && req.path !== "/" && req.path !== "/health" && !req.path.includes("/api/test")) {
    console.log("⚠️  Отсутствует X-Bot-ID заголовок:", req.path);
    
    return res.status(400).json({
      success: false,
      error: "X-Bot-ID header is required",
      code: "MISSING_BOT_ID"
    });
  }
  
  req.botId = botId;
  next();
}

/**
 * Валидация обязательных полей
 * @param {Array} requiredFields - Массив обязательных полей
 */
function validateFields(requiredFields) {
  return function(req, res, next) {
    const missingFields = [];
    
    for (const field of requiredFields) {
      if (!req.body[field]) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        missingFields: missingFields,
        code: "MISSING_FIELDS"
      });
    }
    
    next();
  };
}

/**
 * Обработка ошибок Firebase
 */
function firebaseErrorHandler(err, req, res, next) {
  if (err.message && err.message.includes("Firebase")) {
    console.error("🔥 Firebase error:", err.message);
    
    return res.status(503).json({
      success: false,
      error: "Service temporarily unavailable",
      message: "Database service error",
      code: "FIREBASE_ERROR"
    });
  }
  
  next(err);
}

module.exports = {
  requestLogger,
  botIdValidator,
  validateFields,
  firebaseErrorHandler
};
