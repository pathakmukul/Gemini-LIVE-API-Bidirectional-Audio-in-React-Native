// services/AudioInputService.js
// Rule III: Audio Input Service

import { AUDIO_SAMPLE_RATE, AUDIO_CHANNELS, AUDIO_BITS_PER_SAMPLE, AEC_ENABLED } from '../config';
import WebSocketService from './WebSocketService';
import PermissionsService from './PermissionsService';
import { VoiceProcessor } from '@picovoice/react-native-voice-processor';
import { Buffer } from 'buffer';
import InCallManager from 'react-native-incall-manager';
import { Platform } from 'react-native';
import WebRTCAudioService from './WebRTCAudioService';

// State variables
let isRecording = false;
let isMuted = false; // New mute state flag
let recordingBuffer = [];
let frameListener = null;
let errorListener = null;
let isInCallManagerInitialized = false;

// Get the singleton instance of VoiceProcessor
const voiceProcessor = VoiceProcessor.instance;

/**
 * Initialize InCallManager with AEC and speaker settings
 * This is separated to make it more robust and handle errors properly
 * Falls back to using only the VoiceProcessor if InCallManager is unavailable
 */
const initializeInCallManager = async () => {
  if (isInCallManagerInitialized) {
    console.log('AudioInputService: InCallManager already initialized');
    return true;
  }
  
  // Check if InCallManager is actually available
  if (!InCallManager) {
    console.log('AudioInputService: InCallManager not available, will rely on native AEC');
    return false;
  }
  
  try {
    console.log('AudioInputService: Initializing InCallManager for AEC...');
    
    // Add small delay to ensure device is ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Double-check that InCallManager is still available after the delay
    if (!InCallManager || typeof InCallManager.start !== 'function') {
      console.warn('AudioInputService: InCallManager not available after delay');
      return false;
    }
    
    // Start InCallManager with advanced audio processing enabled
    InCallManager.start({
      media: 'audio',           // Use audio mode
      auto: true,              // Automatically configure
      ringback: '',            // No ringback tone
      force: true,             // Force these settings
      forceSpeakerOn: true,    // Force speaker mode - critical for proper AEC
      // Enable these audio processing features
      enableAEC: true,                   // Acoustic Echo Cancellation
      enableAGC: true,                   // Automatic Gain Control
      enableNS: true,                    // Noise Suppression
      enableHWAEC: Platform.OS === 'android', // Hardware AEC on Android
    });
    
    // Small delay to allow settings to apply
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Verify that InCallManager is available and force speaker mode
    if (InCallManager && typeof InCallManager.setForceSpeakerphoneOn === 'function') {
      InCallManager.setForceSpeakerphoneOn(true);
      console.log('AudioInputService: Speaker mode forced on');
      isInCallManagerInitialized = true;
      return true;
    } else {
      console.warn('AudioInputService: Unable to force speaker mode - method not available');
      return false;
    }
  } catch (error) {
    console.error('AudioInputService: Error initializing InCallManager:', error);
    return false;
  }
};

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
    
    // Enable Acoustic Echo Cancellation (AEC) and other audio processing
    if (AEC_ENABLED) {
      // First try using WebRTC for superior AEC implementation
      console.log('AudioInputService: Initializing WebRTC-based AEC...');
      const webrtcSuccess = await WebRTCAudioService.initialize();
      
      if (webrtcSuccess) {
        await WebRTCAudioService.startAudioProcessing();
        if (WebRTCAudioService.isProcessingActive()) {
          console.log('AudioInputService: WebRTC AEC activated successfully');
        } else {
          console.warn('AudioInputService: WebRTC AEC initialization failed, falling back to InCallManager');
          // Fall back to InCallManager
          const aecSuccess = await initializeInCallManager();
          if (aecSuccess) {
            console.log('AudioInputService: Fallback AEC enabled with speaker mode');
          } else {
            console.warn('AudioInputService: All AEC methods failed - will continue without echo cancellation');
          }
        }
      } else {
        console.warn('AudioInputService: WebRTC AEC initialization failed, falling back to InCallManager');
        // Fall back to InCallManager
        const aecSuccess = await initializeInCallManager();
        if (aecSuccess) {
          console.log('AudioInputService: Fallback AEC enabled with speaker mode');
        } else {
          console.warn('AudioInputService: All AEC methods failed - will continue without echo cancellation');
        }
      }
    }
    
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
      
      // Only send audio if not muted
      if (!isMuted) {
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
      } else {
        console.log('AudioInputService: Audio captured but muted - not sending');
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
    
    // Remove frame and error listeners to ensure no more callbacks occur
    if (frameListener) {
      voiceProcessor.removeFrameListener(frameListener);
    }
    
    if (errorListener) {
      voiceProcessor.removeErrorListener(errorListener);
    }
    
    // Clear buffer
    recordingBuffer = [];
    
    isRecording = false;
    isMuted = false; // Reset mute state when stopping recording
    console.log('AudioInputService: Voice processing stopped');
    
    // We now stop WebRTC AEC here to ensure microphone is fully released
    // This is a change from previous behavior where we kept AEC active
    if (WebRTCAudioService.isProcessingActive()) {
      try {
        await WebRTCAudioService.stopAudioProcessing();
        console.log('AudioInputService: WebRTC AEC stopped with recording');
      } catch (aecErr) {
        console.error('AudioInputService: Error stopping WebRTC AEC:', aecErr);
      }
    }
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

// New mute functions
const setMuted = (muted) => {
  isMuted = muted;
  console.log(`AudioInputService: Microphone ${muted ? 'muted' : 'unmuted'}`);
  return true;
};

const isMicrophoneMuted = () => isMuted;

// Clean up all audio input resources
const cleanupResources = async () => {
  try {
    console.log('AudioInputService: Cleaning up all resources...');
    
    // Stop recording if active
    if (isRecording) {
      await stopRecording();
    }
    
    // Clean up WebRTC resources if active
    if (WebRTCAudioService.isProcessingActive()) {
      await WebRTCAudioService.stopAudioProcessing();
      console.log('AudioInputService: WebRTC AEC resources released');
    }
    
    // Clean up InCallManager if it was initialized
    if (isInCallManagerInitialized && InCallManager) {
      try {
        InCallManager.stop();
        console.log('AudioInputService: InCallManager resources released');
      } catch (err) {
        console.warn('AudioInputService: Error stopping InCallManager:', err);
      }
      isInCallManagerInitialized = false;
    }
    
    // Clear any remaining buffer
    recordingBuffer = [];
    
    console.log('AudioInputService: All resources cleaned up');
    return true;
  } catch (error) {
    console.error('AudioInputService: Error during cleanup:', error);
    return false;
  }
};

export default {
  startRecording,
  stopRecording,
  isRecording: isRecordingActive,
  setMuted,
  isMuted: isMicrophoneMuted,
  sendBufferedAudio,
  cleanupResources,
};
