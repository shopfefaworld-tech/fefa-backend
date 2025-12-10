import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

class RedisConfig {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private isRedisAvailable = true;

  async connect(): Promise<RedisClientType | null> {
    if (this.client && this.isConnected) {
      return this.client;
    }

    if (!this.isRedisAvailable) {
      console.log('⚠️ Redis is disabled, using fallback mode');
      return null;
    }

    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        password: process.env.REDIS_PASSWORD,
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > 10) {
              console.error('❌ Redis connection failed after 10 retries');
              console.log('⚠️ Falling back to in-memory caching');
              this.isRedisAvailable = false;
              return false; // Stop reconnecting
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (err: Error) => {
        console.error('❌ Redis Client Error:', err);
        this.isConnected = false;
        this.isRedisAvailable = false;
        console.log('⚠️ Falling back to in-memory caching');
      });

      this.client.on('connect', () => {
        console.log('🔄 Redis connecting...');
      });

      this.client.on('ready', () => {
        console.log('✅ Redis connected successfully');
        this.isConnected = true;
        this.isRedisAvailable = true;
      });

      this.client.on('end', () => {
        console.log('🔌 Redis connection ended');
        this.isConnected = false;
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      console.log('⚠️ Falling back to in-memory caching');
      this.isRedisAvailable = false;
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
      console.log('🔌 Redis disconnected');
    }
  }

  getClient(): RedisClientType | null {
    return this.client;
  }

  isRedisConnected(): boolean {
    return this.isConnected;
  }

  isRedisEnabled(): boolean {
    return this.isRedisAvailable;
  }
}

export const redisConfig = new RedisConfig();
export default redisConfig;
