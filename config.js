// config.js
// Rule I: Configuration Management

export const API_KEY = 'GEMINI_API_KEY_HERE'; // TODO: Replace with your actual API key (use secure storage)
export const WEBSOCKET_HOST = 'generativelanguage.googleapis.com';
export const WEBSOCKET_PATH = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const MODEL_NAME = 'models/gemini-2.0-flash-live-001'; // Or your desired model
export const AUDIO_SAMPLE_RATE = 16000; // Hz - Ensure this matches the mimeType in WebSocketService
export const AUDIO_CHANNELS = 1; // Mono
export const AUDIO_BITS_PER_SAMPLE = 16; // PCM16
