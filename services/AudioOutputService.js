// services/AudioOutputService.js
// Rule III: Audio Output Service

import { Audio } from 'expo-av'; // Using expo-av instead of expo-audio
import { Buffer } from 'buffer';
import { AUDIO_SAMPLE_RATE, AUDIO_CHANNELS, AUDIO_BITS_PER_SAMPLE, AEC_ENABLED, AGC_ENABLED, NS_ENABLED } from '../config';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import InCallManager from 'react-native-incall-manager';

// Constants for audio output from Gemini Live API
const OUTPUT_SAMPLE_RATE = 24000; // Gemini outputs at 24kHz
const OUTPUT_CHANNELS = 1; // Mono
const OUTPUT_BITS_PER_SAMPLE = 16; // 16-bit PCM

// Audio player state
let soundObject = null;
let isPlaying = false;
let audioQueue = [];
let tempFileCounter = 0;

// Keep track of InCallManager initialization status
let isInCallManagerInitialized = false;

// Initialize InCallManager safely - only if available
const initializeInCallManager = async () => {
  if (isInCallManagerInitialized) {
    console.log('AudioOutputService: InCallManager already initialized');
    return true;
  }
  
  // Check if InCallManager is actually available
  if (!InCallManager) {
    console.log('AudioOutputService: InCallManager not available, skipping initialization');
    return false;
  }
  
  try {
    console.log('AudioOutputService: Initializing InCallManager...');
    
    // Add a small delay to ensure proper device initialization
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Make sure InCallManager is still available after the delay
    if (!InCallManager || typeof InCallManager.start !== 'function') {
      console.warn('AudioOutputService: InCallManager not available after delay');
      return false;
    }
    
    // Start InCallManager with explicit configuration
    InCallManager.start({
      media: 'audio',           // Use audio mode
      auto: true,              // Automatically configure
      ringback: '',            // No ringback tone
      force: true,             // Force these settings
      forceSpeakerOn: true,    // Explicitly force speaker mode
      enableAEC: AEC_ENABLED,  // Enable Acoustic Echo Cancellation
      enableAGC: AGC_ENABLED,  // Enable Automatic Gain Control
      enableNS: NS_ENABLED     // Enable Noise Suppression
    });
    
    // Add another small delay to ensure initialization completes
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Now try to force speaker mode - with extra safety check
    if (InCallManager && typeof InCallManager.setForceSpeakerphoneOn === 'function') {
      InCallManager.setForceSpeakerphoneOn(true);
      console.log('AudioOutputService: Speaker mode forced on');
    } else {
      console.warn('AudioOutputService: Could not force speaker mode - method not available');
    }
    
    // If we made it here, consider InCallManager initialized
    isInCallManagerInitialized = true;
    return true;
  } catch (error) {
    console.error('AudioOutputService: Error initializing InCallManager:', error);
    return false;
  }
};

// Configure audio for playback
const configureAudio = async () => {
  try {
    console.log('AudioOutputService: Configuring audio...');
    
    // Initialize Audio with proper settings for playback - explicitly set for speaker mode
    await Audio.setAudioModeAsync({
      // Critical settings for iOS
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      allowsRecordingIOS: true,       // Allow recording since we're using the mic
      // Force speaker output across platforms
      playThroughEarpieceAndroid: false,
      // Use numeric values directly instead of constants
      interruptionModeIOS: 1,         // 1 = DO_NOT_MIX
      interruptionModeAndroid: 1,      // 1 = DO_NOT_MIX 
    });
    
    console.log('AudioOutputService: Audio playback configured');
    
    // Only after Audio.setAudioModeAsync, initialize InCallManager
    const inCallManagerSuccess = await initializeInCallManager();
    
    // If on iOS, apply additional platform-specific settings
    if (Platform.OS === 'ios') {
      try {
        // Force route change to speaker on iOS
        // This uses AVAudioSession directly through expo-av
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          allowsRecordingIOS: true,
          interruptionModeIOS: 1,         // 1 = DO_NOT_MIX
          interruptionModeAndroid: 1,     // 1 = DO_NOT_MIX
          playThroughEarpieceAndroid: false,
        });
        console.log('AudioOutputService: iOS audio session set for speaker output');
      } catch (iosError) {
        console.warn('AudioOutputService: Error configuring iOS audio session:', iosError);
      }
    }
    
    // Set audio to maximum volume on Android
    if (Platform.OS === 'android' && isInCallManagerInitialized) {
      try {
        InCallManager.setAudioVolume(1.0);
      } catch (volumeError) {
        console.warn('AudioOutputService: Error setting audio volume:', volumeError);
      }
    }
    
    console.log('AudioOutputService: Audio configured successfully');
    return true;
  } catch (error) {
    console.error('AudioOutputService: Error configuring audio:', error);
    return false;
  }
};

// --- Helper Functions for WAV creation --- START ---

/**
 * Creates a WAV file from PCM data
 * @param {Uint8Array|ArrayBuffer} pcmData - Raw PCM audio data
 * @param {number} sampleRate - Sample rate in Hz (e.g., 24000 for Gemini API)
 * @param {number} numChannels - Number of audio channels (1 for mono, 2 for stereo)
 * @param {number} bitsPerSample - Bits per sample (usually 16)
 * @returns {Buffer} - WAV file data as a Buffer
 */
const _createWavFromPcm = (pcmData, sampleRate, numChannels, bitsPerSample) => {
  try {
    const pcmBytes = pcmData instanceof ArrayBuffer ? new Uint8Array(pcmData) : pcmData;
    const header = _createWavHeader(sampleRate, bitsPerSample, numChannels, pcmBytes.length);
    const wavData = _combineWavData(header, pcmBytes);
    console.log(`📻👷 AudioOutputService: Created WAV (${wavData.length} bytes) from PCM (${pcmBytes.length} bytes) at ${sampleRate}Hz, ${numChannels}ch, ${bitsPerSample}bit`);
    return wavData;
  } catch (error) {
    console.error('Error creating WAV from PCM:', error);
    throw error;
  }
};

/**
 * Creates a WAV header with the specified audio parameters
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} bitsPerSample - Bits per sample (8, 16, etc.)
 * @param {number} numChannels - Number of channels (1 for mono, 2 for stereo)
 * @param {number} dataLength - Length of audio data in bytes
 * @returns {Buffer} - WAV header as a Buffer
 */
const _createWavHeader = (sampleRate, bitsPerSample, numChannels, dataLength) => {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44); // WAV header is 44 bytes

  // RIFF header
  buffer.write('RIFF', 0); // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize: 36 + SubChunk2Size
  buffer.write('WAVE', 8); // Format

  // fmt subchunk
  buffer.write('fmt ', 12); // SubChunk1ID
  buffer.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample

  // data subchunk
  buffer.write('data', 36); // SubChunk2ID
  buffer.writeUInt32LE(dataLength, 40); // SubChunk2Size

  return buffer;
};

/**
 * Combines WAV header with PCM data
 * @param {Buffer} header - WAV header
 * @param {Uint8Array|Buffer} pcmData - PCM audio data
 * @returns {Buffer} - Combined WAV file as a Buffer
 */
const _combineWavData = (header, pcmData) => {
  try {
    const combinedLength = header.length + pcmData.length;
    const combinedBuffer = Buffer.alloc(combinedLength);
    
    // Copy header and PCM data into the combined buffer
    header.copy(combinedBuffer, 0);
    
    // Copy PCM data after the header
    if (pcmData instanceof Buffer) {
      pcmData.copy(combinedBuffer, header.length);
    } else {
      // Handle Uint8Array
      Buffer.from(pcmData).copy(combinedBuffer, header.length);
    }
    
    return combinedBuffer;
  } catch (error) {
    console.error('Error combining WAV data:', error);
    throw error;
  }
};

/**
 * Save WAV data to a temporary file
 * @param {Buffer} wavData - WAV file data
 * @returns {Promise<string>} - URI of the saved file
 */
const _saveWavToTempFile = async (wavData) => {
  try {
    // Create a unique filename for this audio chunk
    const tempFilePath = `${FileSystem.cacheDirectory}audio_${Date.now()}_${tempFileCounter++}.wav`;
    
    // Convert Buffer to base64 string for FileSystem.writeAsStringAsync
    const base64Data = wavData.toString('base64');
    
    // Write the file
    await FileSystem.writeAsStringAsync(tempFilePath, base64Data, { encoding: FileSystem.EncodingType.Base64 });
    
    console.log(`AudioOutputService: Saved WAV file to ${tempFilePath}`);
    return tempFilePath;
  } catch (error) {
    console.error('Error saving WAV to temp file:', error);
    throw error;
  }
};

// --- Helper Functions --- END ---

/**
 * Play audio from a sound object
 * @param {Audio.Sound} sound - The sound object to play
 * @returns {Promise<boolean>} - Whether playback started successfully
 */
const _playSoundObject = async (sound) => {
  try {
    console.log('AudioOutputService: Playing sound object');
    
    // Ensure audio is forced to speaker before every playback
    try {
      // Re-activate the audio session with speaker mode forced
      await Audio.setIsEnabledAsync(true);
      
      // Set audio mode explicitly to force speaker mode each time
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        allowsRecordingIOS: true,
        // Force speaker output across platforms
        playThroughEarpieceAndroid: false,
        // Use numeric values instead of constants
        interruptionModeIOS: 1,          // 1 = DO_NOT_MIX 
        interruptionModeAndroid: 1,      // 1 = DO_NOT_MIX
      });
      
      // Force speaker mode with InCallManager if available
      if (isInCallManagerInitialized && 
          InCallManager && 
          typeof InCallManager.setForceSpeakerphoneOn === 'function') {
        InCallManager.setForceSpeakerphoneOn(true);
      }
      
      // Set audio mode again to ensure the session is active
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        allowsRecordingIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: 1, // Using numeric value instead of constant
        interruptionModeAndroid: 1, // Using numeric value instead of constant
      });
      
      // Ensure speaker mode is active right before playback
      // Add null check to prevent errors
      if (InCallManager && typeof InCallManager.setForceSpeakerphoneOn === 'function') {
        InCallManager.setForceSpeakerphoneOn(true);
      }
      
      console.log('AudioOutputService: Audio session re-activated for playback with speaker mode');
    } catch (sessionError) {
      console.warn('AudioOutputService: Error re-activating audio session:', sessionError);
      // Continue anyway, as the error might be that it's already activated
    }
    
    // Set volume to maximum for the sound object if possible
    try {
      // Set the volume for this specific sound to maximum
      await sound.setVolumeAsync(1.0);
      console.log('AudioOutputService: Sound volume set to maximum');
    } catch (volumeError) {
      console.warn('AudioOutputService: Could not set sound volume:', volumeError);
    }
    
    // Play the sound
    await sound.playAsync();
    console.log('AudioOutputService: Playback started successfully');
    return true;
  } catch (error) {
    console.error('AudioOutputService: Error playing sound:', error);
    return false;
  }
};

/**
 * Clean up a sound object
 * @param {Audio.Sound} sound - The sound object to unload
 */
const _cleanupSoundObject = async (sound) => {
  try {
    if (sound) {
      await sound.unloadAsync();
      console.log('AudioOutputService: Sound unloaded');
    }
  } catch (error) {
    console.error('AudioOutputService: Error unloading sound:', error);
  }
};

/**
 * Process the audio queue
 */
const _processQueue = async () => {
  if (isPlaying || audioQueue.length === 0) {
    return;
  }
  
  try {
    isPlaying = true;
    const queueItem = audioQueue.shift();
    
    // Handle the new object format with type, data, and mimeType fields
    // Extract the actual audio data from the object if needed
    let audioData, sampleRate;
    
    if (queueItem && typeof queueItem === 'object' && queueItem.type === 'audio' && queueItem.data) {
      // New format: { type: 'audio', data: arrayBuffer, mimeType: string }
      audioData = queueItem.data;
      
      // Parse sample rate from mimeType if available
      if (queueItem.mimeType && queueItem.mimeType.includes('rate=')) {
        const rateMatch = queueItem.mimeType.match(/rate=(\d+)/);
        if (rateMatch && rateMatch[1]) {
          sampleRate = parseInt(rateMatch[1], 10);
          console.log(`AudioOutputService: Detected sample rate from mimeType: ${sampleRate}Hz`);
        }
      }
    } else {
      // Legacy format: direct audio data
      audioData = queueItem;
    }
    
    // Validate audio data
    if (!audioData) {
      console.error('AudioOutputService: Received null or empty audio data');
      isPlaying = false;
      _processQueue(); // Try next item
      return;
    }
    
    // Log detailed info about the audio data for debugging
    console.log(
      `🔊🔊 AudioOutputService: audioData type=${typeof audioData}` +
      (audioData instanceof ArrayBuffer
        ? `, ArrayBuffer length=${audioData.byteLength}`
        : audioData instanceof Uint8Array
        ? `, Uint8Array length=${audioData.length}`
        : typeof audioData === 'string'
        ? `, String length=${audioData.length}`
        : '')
    );
    
    // Use detected sample rate or fallback to default
    const outputSampleRate = sampleRate || OUTPUT_SAMPLE_RATE;
    console.log(`  - Using sample rate: ${outputSampleRate}Hz`);
    
    // Create a WAV file from the PCM data
    let wavData;
    
    try {
      if (typeof audioData === 'string') {
        // Handle Base64 encoded audio
        console.log('  - Converting Base64 string to PCM data');
        const pcmData = Buffer.from(audioData, 'base64');
        wavData = _createWavFromPcm(pcmData, outputSampleRate, OUTPUT_CHANNELS, OUTPUT_BITS_PER_SAMPLE);
      } else if (audioData instanceof ArrayBuffer || audioData instanceof Uint8Array) {
        // Handle raw PCM data
        console.log('  - Converting ArrayBuffer/Uint8Array to WAV');
        wavData = _createWavFromPcm(audioData, outputSampleRate, OUTPUT_CHANNELS, OUTPUT_BITS_PER_SAMPLE);
      } else {
        console.error('AudioOutputService: Unsupported audio data format', typeof audioData);
        if (audioData && typeof audioData === 'object') {
          console.error('Keys available:', Object.keys(audioData));
        }
        isPlaying = false;
        _processQueue(); // Try next item
        return;
      }
    } catch (wavError) {
      console.error('AudioOutputService: Error creating WAV data:', wavError);
      isPlaying = false;
      _processQueue(); // Try next item
      return;
    }
    
    // Validate WAV data
    if (!wavData || wavData.length < 44) { // 44 is minimum WAV header size
      console.error(`AudioOutputService: Invalid WAV data created (size: ${wavData ? wavData.length : 'null'})`);
      isPlaying = false;
      _processQueue(); // Try next item
      return;
    }
    
    try {
      // Save WAV to a temporary file
      const tempFilePath = await _saveWavToTempFile(wavData);
      
      // Clean up previous sound object if it exists
      if (soundObject) {
        await _cleanupSoundObject(soundObject);
      }
      
      // Create a new sound object
      console.log('AudioOutputService: Creating sound object from file:', tempFilePath);
      soundObject = new Audio.Sound();
      
      // Make sure audio is enabled before loading
      await Audio.setIsEnabledAsync(true);
      
      // Load the sound with proper options
      console.log('AudioOutputService: Loading sound file...');
      await soundObject.loadAsync(
        { uri: tempFilePath },
        { shouldPlay: false, progressUpdateIntervalMillis: 50 }
      );
      console.log('AudioOutputService: Sound loaded successfully');
      
      // Set up completion listener
      soundObject.setOnPlaybackStatusUpdate(status => {
        if (status.didJustFinish) {
          console.log('AudioOutputService: Playback finished');
          isPlaying = false;
          _processQueue(); // Process next item in queue
        }
        
        if (status.error) {
          console.error('AudioOutputService: Playback error:', status.error);
          isPlaying = false;
          _processQueue(); // Try next item
        }
      });
      
      // Play the sound
      console.log('AudioOutputService: Playing audio');
      const playSuccess = await _playSoundObject(soundObject);
      
      if (!playSuccess) {
        console.error('AudioOutputService: Failed to play audio');
        isPlaying = false;
        _processQueue(); // Try next item
      }
    } catch (error) {
      console.error('AudioOutputService: Error playing audio:', error);
      isPlaying = false;
      _processQueue(); // Try next item
    }
  } catch (error) {
    console.error('AudioOutputService: Error processing audio:', error);
    console.error('Stack trace:', error.stack);
    isPlaying = false;
    _processQueue(); // Try next item
  }
};

/**
 * Play an audio chunk received from the WebSocket
 * @param {ArrayBuffer|Uint8Array|string|Object} audioData - Audio data, possibly Base64 encoded or in an object
 */
const playAudioChunk = async (audioData) => {
  if (!audioData) {
    console.warn('AudioOutputService: Received null or undefined audio data');
    return;
  }
  
  try {
    // Initialize audio if not done already
    await configureAudio();
    
    // Log information about the audio data
    const dataType = typeof audioData;
    let dataSize = 'unknown';
    
    if (dataType === 'string') {
      dataSize = `${audioData.length} chars`;
    } else if (audioData instanceof ArrayBuffer) {
      dataSize = `${audioData.byteLength} bytes`;
    } else if (audioData instanceof Uint8Array) {
      dataSize = `${audioData.length} bytes`;
    } else if (dataType === 'object') {
      dataSize = audioData.data ? 
        (audioData.data instanceof ArrayBuffer ? 
          `${audioData.data.byteLength} bytes` : 
          (typeof audioData.data === 'string' ? 
            `${audioData.data.length} chars` : 'unknown format'))
        : 'no data field';
    }
    
    console.log(` 🎵 AudioOutputService: Received audio chunk to play. Type: ${dataType}, Size: ${dataSize}${dataType === 'object' && audioData.mimeType ? `, MIME type: ${audioData.mimeType}` : ''}`);
    
    // Add to queue
    audioQueue.push(audioData);
    console.log(`AudioOutputService: Added audio to queue. Queue length: ${audioQueue.length}`);
    
    // Process queue
    _processQueue();
  } catch (error) {
    console.error('AudioOutputService: Error queuing audio chunk:', error);
  }
};

/**
 * Cleanup audio resources and stop InCallManager
 * @returns {Promise<boolean>} - Whether cleanup was successful
 */
const cleanupAudioResources = async () => {
  try {
    console.log('AudioOutputService: Cleaning up audio resources...');
    
    // Stop InCallManager if it's running and AEC isn't enabled
    // If AEC is enabled, we leave InCallManager running to maintain AEC across sessions
    // We only stop it when the app is shutting down
    try {
      if (!AEC_ENABLED) {
        InCallManager.stop();
        console.log('AudioOutputService: InCallManager stopped');
      } else {
        console.log('AudioOutputService: Keeping InCallManager running for AEC');
      }
    } catch (inCallError) {
      console.warn('AudioOutputService: Error managing InCallManager:', inCallError);
    }
    
    // Clean up any sound objects
    if (soundObject) {
      try {
        await _cleanupSoundObject(soundObject);
        soundObject = null;
      } catch (soundError) {
        console.warn('AudioOutputService: Error cleaning up sound object:', soundError);
      }
    }
    
    isPlaying = false;
    console.log('AudioOutputService: Audio resources cleaned up');
  } catch (error) {
    console.error('AudioOutputService: Error during cleanup:', error);
  }
};

/**
 * Clear the audio playback queue and stop current playback
 */
const clearPlaybackQueue = async () => {
  console.log('AudioOutputService: Clearing playback queue');
  
  // Clear the queue
  audioQueue = [];
  
  // Stop current playback if active
  if (soundObject && isPlaying) {
    try {
      await soundObject.stopAsync();
      await _cleanupSoundObject(soundObject);
      soundObject = null;
    } catch (error) {
      console.error('🚨 AudioOutputService: Error stopping playback:', error);
    }
  }

  isPlaying = false;
};

// Clean up temporary files periodically
const cleanupTempFiles = async () => {
  try {
    const cacheDir = FileSystem.cacheDirectory;
    const files = await FileSystem.readDirectoryAsync(cacheDir);
    const audioFiles = files.filter(file => file.startsWith('audio_') && file.endsWith('.wav'));
    
    console.log(`AudioOutputService: Found ${audioFiles.length} temporary audio files to clean up`);
    
    // Keep the 5 most recent files and delete the rest
    if (audioFiles.length > 5) {
      // Sort by creation time (which is part of the filename)
      audioFiles.sort().reverse();
      
      // Delete older files
      for (let i = 5; i < audioFiles.length; i++) {
        const filePath = `${cacheDir}${audioFiles[i]}`;
        await FileSystem.deleteAsync(filePath);
        console.log(`AudioOutputService: Deleted temporary file ${audioFiles[i]}`);
      }
    }
  } catch (error) {
    console.error('AudioOutputService: Error cleaning up temp files:', error);
  }
};

// Initialize the audio when the module loads
configureAudio();

// Set up a timer to clean up temporary files every 5 minutes
setInterval(cleanupTempFiles, 5 * 60 * 1000);

// Add event listener for app state changes to clean up resources when app is closed
if (Platform.OS === 'ios') {
  // For iOS, we need to listen for app termination
  try {
    const { AppState } = require('react-native');
    AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'inactive' || nextAppState === 'background') {
        // App is going to background or being closed, clean up resources
        cleanupAudioResources();
      }
    });
  } catch (error) {
    console.warn('AudioOutputService: Could not set up AppState listener:', error);
  }
}

export default {
  playAudioChunk,
  clearPlaybackQueue,
  cleanupAudioResources, // Export the cleanup function so it can be called from outside
};
