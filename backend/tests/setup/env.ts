// Test configuration. Tests always use an isolated database whose name must contain "test".
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/mathhack_test?replicaSet=rs0';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.BACKEND_PUBLIC_URL = 'http://localhost:4000';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-for-hmac-signing-0123456789';
process.env.RATE_LIMIT_DISABLED = 'true';

const dbName = new URL(process.env.MONGODB_URI.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.slice(1);
if (!/test/i.test(dbName)) {
  throw new Error(`Refusing to run tests against database "${dbName}": the name must contain "test".`);
}
