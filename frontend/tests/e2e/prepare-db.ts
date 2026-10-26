/** Resets the isolated E2E database and creates the test host. Refuses any database without "test" in its name. */
import mongoose from 'mongoose';
import { createHostAccount } from '../../../backend/src/services/authService.js';

const uri = process.env.MONGODB_URI!;
const name = new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.slice(1);
if (!/test/i.test(name)) throw new Error(`Refusing to reset database "${name}"`);

await mongoose.connect(uri);
await mongoose.connection.dropDatabase();
await mongoose.connection.syncIndexes();
await createHostAccount({ name: 'E2E Host', email: 'e2e-host@mathhack.test', password: 'E2eHostPassw0rd' });
await mongoose.disconnect();
