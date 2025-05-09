// services/AudioInputService.js
// Rule III: Audio Input Service

import { AUDIO_SAMPLE_RATE, AUDIO_CHANNELS, AUDIO_BITS_PER_SAMPLE } from '../config';
import WebSocketService from './WebSocketService';
import PermissionsService from './PermissionsService';
import { VoiceProcessor } from '@picovoice/react-native-voice-processor';
import { Buffer } from 'buffer';

// State variables
let isRecording = false;
let recordingBuffer = [];
let frameListener = null;
let errorListener = null;

// Get the singleton instance of VoiceProcessor
const voiceProcessor = VoiceProcessor.instance;

// Initialize the voice processor
const initializeVoiceProcessor = async () => {
  try {
    // Request recording permissions
    const permissionsGranted = await PermissionsService.requestMicrophonePermission();
    if (!permissionsGranted) {
      console.error('AudioInputService: Recording permissions not granted');
      return false;
    }
    
    console.log('AudioInputService: Initializing voice processor...');
    
    // Remove any existing listeners to avoid duplicates
    if (frameListener) {
      voiceProcessor.removeFrameListener(frameListener);
      frameListener = null;
    }
    
    if (errorListener) {
      voiceProcessor.removeErrorListener(errorListener);
      errorListener = null;
    }
    
    // Set up frame processing callback
    frameListener = (frame) => {
      // Frame is an array of 16-bit integers (PCM samples)
      const audioData = new Int16Array(frame).buffer;
      
      // Log data for debugging
      console.log(`AudioInputService: Captured audio frame of ${audioData.byteLength} bytes`);
      
      // Send to WebSocket if connection is ready
      if (WebSocketService.isConnected() && WebSocketService.isSetupComplete()) {
        WebSocketService.sendAudioChunk(audioData);
      } else {
        console.log('AudioInputService: WebSocket not ready, buffering audio');
        recordingBuffer.push(audioData);
        
        // Prevent buffer from growing too large
        if (recordingBuffer.length > 10) {
          recordingBuffer.shift();
        }
      }
    };
    
    // Set up error listener
    errorListener = (error) => {
      console.error('AudioInputService: Voice processor error:', error);
    };
    
    // Add the listeners
    voiceProcessor.addFrameListener(frameListener);
    voiceProcessor.addErrorListener(errorListener);
    
    console.log('AudioInputService: Voice processor initialized successfully');
    return true;
  } catch (err) {
    console.error('AudioInputService: Failed to initialize voice processor:', err);
    return false;
  }
};

const startRecording = async () => {
  if (isRecording) {
    console.log('AudioInputService: Already recording');
    return true;
  }

  try {
    // Initialize voice processor if needed
    await initializeVoiceProcessor();
    
    console.log('AudioInputService: Starting voice processing...');
    
    // Check if we have permission
    if (await voiceProcessor.hasRecordAudioPermission()) {
      // Start capturing audio with specific frame length
      const frameLength = 512; // Number of samples per frame
      await voiceProcessor.start(frameLength, AUDIO_SAMPLE_RATE);
      
      isRecording = true;
      console.log('🗣️⛮AudioInputService: Voice processing started at', AUDIO_SAMPLE_RATE, 'Hz');
      return true;
    } else {
      console.error('AudioInputService: No recording permission');
      return false;
    }
  } catch (err) {
    console.error('AudioInputService: Failed to start voice processing:', err);
    return false;
  }
};

const stopRecording = async () => {
  if (!isRecording) {
    console.log('AudioInputService: Not recording');
    return;
  }

  try {
    console.log('AudioInputService: Stopping voice processing...');
    
    // Stop capturing audio
    await voiceProcessor.stop();
    
    // Clear buffer
    recordingBuffer = [];
    
    isRecording = false;
    console.log('AudioInputService: Voice processing stopped');
  } catch (err) {
    console.error('AudioInputService: Error stopping voice processing:', err);
  }
};

// Send any buffered audio data once WebSocket setup is complete
const sendBufferedAudio = () => {
  if (recordingBuffer.length > 0 && WebSocketService.isConnected() && WebSocketService.isSetupComplete()) {
    console.log(`AudioInputService: Sending ${recordingBuffer.length} buffered audio chunks`);
    
    for (const audioBuffer of recordingBuffer) {
      WebSocketService.sendAudioChunk(audioBuffer);
    }
    
    recordingBuffer = [];
  }
};

const isRecordingActive = () => isRecording;

export default {
  startRecording,
  stopRecording,
  isRecording: isRecordingActive,
  sendBufferedAudio,
};
