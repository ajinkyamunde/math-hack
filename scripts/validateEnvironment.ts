/** Validates the environment without starting the server: npm run validate-env */
import dns from 'node:dns';
import mongoose from 'mongoose';
import { EnvironmentError, getEnv } from '../backend/src/config/environment.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

async function main(): Promise<void> {
  try {
    const env = getEnv();
    console.log(`Environment OK (${env.NODE_ENV}). Frontend origin: ${new URL(env.FRONTEND_URL).origin}`);
    if (env.NODE_ENV === 'production') {
      const warnings: string[] = [];
      if (!env.FRONTEND_URL.startsWith('https://')) warnings.push('FRONTEND_URL should use https in production.');
      if (!env.BACKEND_PUBLIC_URL.startsWith('https://')) warnings.push('BACKEND_PUBLIC_URL should use https in production.');
      if (!env.TRUST_PROXY) warnings.push('TRUST_PROXY is 0; set it to the number of proxies in front of the backend so rate limiting sees real client IPs.');
      warnings.forEach((w) => console.warn(`warning: ${w}`));
    }
    if (process.argv.includes('--check-db')) {
      await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      console.log(`MongoDB reachable (database "${mongoose.connection.name}").`);
      await mongoose.disconnect();
    }
  } catch (error) {
    if (error instanceof EnvironmentError) console.error(error.message);
    else console.error(`Validation failed: ${error instanceof Error ? error.message.replace(/\/\/[^@]+@/, '//[redacted]@') : 'unknown error'}`);
    process.exit(1);
  }
}

void main();
