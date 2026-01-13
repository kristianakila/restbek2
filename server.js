// server.js - Главный файл приложения
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

// Импорт модулей
const firebaseService = require("./services/firebaseService");
const middleware = require("./middleware/middleware");
const routes = require("./routes/routes");

// =====================================================
// 🛠️ НАСТРОЙКА СЕРВЕРА
// =====================================================

// CORS middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Bot-ID', 'X-Bot-Token', 'X-User-ID', 'X-Platform'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400
}));

// Предварительные запросы OPTIONS
app.options('*', cors());

// Общие middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Кастомные middleware
app.use(middleware.requestLogger);
app.use(middleware.botIdValidator);

// =====================================================
// 📊 ИНИЦИАЛИЗАЦИЯ СЕРВИСОВ
// =====================================================

// Инициализация Firebase
const firebaseInitialized = firebaseService.initializeFirebase();
app.locals.firebaseInitialized = firebaseInitialized;
app.locals.db = firebaseService.getDatabase();

// =====================================================
// 🗺️ РЕГИСТРАЦИЯ МАРШРУТОВ
// =====================================================

// Системные маршруты
app.get("/", (req, res) => {
  res.json({
    status: "online",
    name: "Telegram Mini Apps Backend",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized ? "connected" : "disconnected",
    cors: "enabled",
    endpoints: [
      "GET  /                    - Эта страница",
      "GET  /health              - Проверка здоровья сервера",
      "GET  /api/test            - Тест API",
      "GET  /api/firebase-status - Статус Firebase",
      "POST /api/user-status     - Статус пользователя (новый)",
      "POST /api/check-subscription - Проверка подписки (новый)",
      "POST /api/spin            - Вращение колеса",
      "POST /api/submit-lead     - Отправка лида",
      "POST /api/lead-fallback   - Фолбэк для лида",
      "GET  /api/wheel-config    - Конфигурация колеса (новый)"
    ]
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    },
    firebase: firebaseInitialized ? "connected" : "disconnected",
    node: process.version
  });
});

// API маршруты
app.use("/api", routes);

// =====================================================
// ❌ ОБРАБОТКА ОШИБОК
// =====================================================

// 404 - Маршрут не найден
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error("💥 Unhandled error:", err.message);
  
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: "Something went wrong",
    code: "SERVER_ERROR",
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// 🚀 ЗАПУСК СЕРВЕРА
// =====================================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`
  🚀 Сервер запущен!
  
  🔗 URL: http://${HOST}:${PORT}
  📊 Здоровье: /health
  🔥 Firebase: ${firebaseInitialized ? '✅' : '❌'}
  
  📍 Порт: ${PORT}
  ⏰ Время: ${new Date().toISOString()}
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM получен, graceful shutdown...');
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT получен, graceful shutdown...');
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});

module.exports = app;
