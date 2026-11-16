import { GoogleGenAI } from '@google/genai';
import { getAppSetting } from './services/appSettingsService.ts';

let aiClient: GoogleGenAI | null = null;
let cachedApiKey = '';

export async function getGeminiClient(): Promise<GoogleGenAI> {
  const apiKey = (await getAppSetting('GEMINI_API_KEY', '')).trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured in app_settings.'
    );
  }
  if (!aiClient || cachedApiKey !== apiKey) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return aiClient;
}
