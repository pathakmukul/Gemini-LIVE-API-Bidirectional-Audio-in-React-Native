// services/AudioOutputService.js
// Rule III: Audio Output Service

import { Audio } from 'expo-av'; // Using expo-av instead of expo-audio
import { Buffer } from 'buffer';
import { AUDIO_SAMPLE_RATE, AUDIO_CHANNELS, AUDIO_BITS_PER_SAMPLE } from '../config';
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

// Configure audio for playback
const configureAudio = async () => {
  try {
    console.log('AudioOutputService: Configuring audio...');
    
    // Initialize Audio with proper settings for playback
    await Audio.setAudioModeAsync({
      // Critical settings for iOS
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      // This is important - we need to allow recording since we're using the mic
      allowsRecordingIOS: true,
      // Android specific settings
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      // Ensure audio session is properly activated - using numeric values instead of constants
      interruptionModeIOS: 1, // Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX = 1
      interruptionModeAndroid: 1, // Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX = 1
    });
    
    // Use InCallManager to force audio to use the speaker (bottom-firing) instead of earpiece
    // This will also help increase the volume
    try {
      console.log('AudioOutputService: Setting up InCallManager for speaker mode...');
      
      // Start InCallManager with speaker on
      InCallManager.start({media: 'audio', auto: true, ringback: ''});
      
      // Force audio to use the speaker
      InCallManager.setForceSpeakerphoneOn(true);
      
      // Set audio to maximum volume
      if (Platform.OS === 'android') {
        // On Android, we can set the exact volume
        InCallManager.setAudioVolume(1.0); // Set to maximum (1.0)
      } else {
        // On iOS, we can only suggest the volume, but the user controls it
        // We'll use the system volume controls
      }
      
      console.log('AudioOutputService: InCallManager configured for speaker mode');
    } catch (inCallError) {
      console.warn('AudioOutputService: Error configuring InCallManager:', inCallError);
      // Continue anyway, as the basic audio might still work
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
    console.log(`Creating WAV from PCM data:`);
    console.log(`  - Sample rate: ${sampleRate}Hz`);
    console.log(`  - Channels: ${numChannels}`);
    console.log(`  - Bits per sample: ${bitsPerSample}`);
    
    // Convert ArrayBuffer to Uint8Array if needed
    const pcmBytes = pcmData instanceof ArrayBuffer ? new Uint8Array(pcmData) : pcmData;
    console.log(`  - PCM data size: ${pcmBytes.length} bytes`);
    
    // Create WAV header
    const header = _createWavHeader(sampleRate, bitsPerSample, numChannels, pcmBytes.length);
    console.log(`  - WAV header size: ${header.length} bytes`);
    
    // Combine header and PCM data
    const wavData = _combineWavData(header, pcmBytes);
    console.log(`  - Total WAV size: ${wavData.length} bytes`);
    
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
    
    // Ensure audio session is properly activated before playback
    try {
      // Re-activate the audio session to ensure it's ready for playback
      await Audio.setIsEnabledAsync(true);
      
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
      InCallManager.setForceSpeakerphoneOn(true);
      
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
    console.log('AudioOutputService: Processing audio data:');
    console.log(`  - Type: ${typeof audioData}`);
    if (audioData instanceof ArrayBuffer) {
      console.log(`  - ArrayBuffer length: ${audioData.byteLength} bytes`);
    } else if (audioData instanceof Uint8Array) {
      console.log(`  - Uint8Array length: ${audioData.length} bytes`);
    } else if (typeof audioData === 'string') {
      console.log(`  - String length: ${audioData.length} chars`);
    }
    
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
    
    console.log(`AudioOutputService: Received audio chunk to play`);
    console.log(`  - Type: ${dataType}`);
    console.log(`  - Size: ${dataSize}`);
    if (dataType === 'object' && audioData.mimeType) {
      console.log(`  - MIME type: ${audioData.mimeType}`);
    }
    
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
 */
const cleanupAudioResources = async () => {
  try {
    console.log('AudioOutputService: Cleaning up audio resources...');
    
    // Stop InCallManager if it's running
    try {
      InCallManager.stop();
      console.log('AudioOutputService: InCallManager stopped');
    } catch (inCallError) {
      console.warn('AudioOutputService: Error stopping InCallManager:', inCallError);
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
      console.error('AudioOutputService: Error stopping playback:', error);
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
