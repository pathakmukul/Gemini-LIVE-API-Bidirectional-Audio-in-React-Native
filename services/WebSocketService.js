// services/WebSocketService.js
// Rule II: WebSocket Service - Revised for Gemini Live

import {
  API_KEY,
  WEBSOCKET_HOST,
  WEBSOCKET_PATH,
  MODEL_NAME,
  AUDIO_SAMPLE_RATE,
} from '../config';
import { Buffer } from 'buffer'; // For binary data conversion

let ws = null;
let onMessageCallback = null;
let onStatusUpdateCallback = null;
let onErrorCallback = null;
let onInterruptionCallback = null;
let onTurnCompleteCallback = null;
let setupCompleted = false;
let audioChunkCounter = 0; // Keep track of chunks sent

const connect = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('WebSocket already connected.');
    return;
  }

  const apiKey = API_KEY; // Ensure API_KEY is loaded correctly
  if (!apiKey) {
    console.error("WebSocketService: API_KEY is missing!");
    // Notify UI or handle error
    if (onErrorCallback) onErrorCallback("API Key is missing.");
    return;
  }

  const url = `wss://${WEBSOCKET_HOST}${WEBSOCKET_PATH}?key=${apiKey}`;
  console.log('Connecting to WebSocket:', url);
  ws = new WebSocket(url);
  audioChunkCounter = 0; // Reset counter on new connection

  ws.onopen = () => {
    console.log('WebSocket connected');
    sendInitialSetup();
    onStatusUpdateCallback?.('connected');
  };

  ws.onclose = (event) => {
    console.log('WebSocket disconnected:', event.code, event.reason);
    ws = null;
    onStatusUpdateCallback?.('disconnected');
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    onErrorCallback?.(error.message || 'WebSocket error');
    onStatusUpdateCallback?.('error');
  };

  ws.onmessage = (event) => {
    // Track message count for debugging
    if (!window._wsMessagesReceived) window._wsMessagesReceived = 0;
    window._wsMessagesReceived++;
    
    // Calculate response time if we've sent audio
    let responseTime = '';
    if (window._lastAudioSentTime) {
      const now = Date.now();
      const timeSinceLastAudio = now - window._lastAudioSentTime;
      responseTime = ` (${timeSinceLastAudio}ms after last audio)`;
    }
    
    console.log(`WebSocketService: Received message #${window._wsMessagesReceived}${responseTime}`);
    
    try {
      // Handle binary data which could be either PCM audio or JSON in binary form
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        let dataSize = 0;
        let dataType = event.data instanceof ArrayBuffer ? 'ArrayBuffer' : 'Blob';
        
        if (event.data instanceof ArrayBuffer) {
          dataSize = event.data.byteLength;
        } else if (event.data instanceof Blob) {
          dataSize = event.data.size;
        }
        
        console.log(`🪵 Received binary data from WebSocket: Size: ${dataSize} bytes, Type: ${dataType}, MIME type: ${event.data.type || 'none'}, Received at: ${new Date().toISOString()}`);
        
        // Track binary message types and sizes for debugging
        if (!window._binaryMessageTypes) {
          window._binaryMessageTypes = {};
          window._binaryMessageSizes = [];
        }
        
        const typeKey = event.data.type || dataType;
        window._binaryMessageTypes[typeKey] = (window._binaryMessageTypes[typeKey] || 0) + 1;
        window._binaryMessageSizes.push(dataSize);
        
        const avgSize = window._binaryMessageSizes.reduce((sum, size) => sum + size, 0) / window._binaryMessageSizes.length;
        
        console.log(`🪵 Binary messages received: ${window._binaryMessageSizes.length}, Average binary message size: ${avgSize.toFixed(2)} bytes, Binary message types received: ${JSON.stringify(window._binaryMessageTypes)}`);
        
        // Process the binary data
        if (event.data instanceof ArrayBuffer) {
          // Process ArrayBuffer directly
          processWebSocketBinaryData(event.data, ws, onMessageCallback, handleReceivedMessage);
        } else if (event.data instanceof Blob) {
          // For Blob, we need to read it as ArrayBuffer first
          console.log(`  - Reading Blob as ArrayBuffer...`);
          const reader = new FileReader();
          
          reader.onload = function() {
            console.log(`  - Successfully read Blob (${this.result.byteLength} bytes)`);
            const arrayBuffer = this.result;
            processWebSocketBinaryData(arrayBuffer, ws, onMessageCallback, handleReceivedMessage);
          };
          
          reader.onerror = function() {
            console.error(`  - Error reading Blob:`, this.error);
          };
          
          reader.readAsArrayBuffer(event.data);
        }
      } else if (typeof event.data === 'string') {
        // Handle text data (likely JSON)
        console.log(`🪵 Received text data from WebSocket: Length: ${event.data.length} characters, First 100 chars: ${event.data.substring(0, 100)}...`);
        
        try {
          const message = JSON.parse(event.data);
          console.log(`Successfully parsed JSON message with keys: ${Object.keys(message).join(', ')}`);
          handleReceivedMessage(message);
        } catch (error) {
          console.error(`Error parsing WebSocket message: ${error} | Raw message content: ${event.data.substring(0, 200)}...`);
          onErrorCallback?.('Error parsing server message');
        }
      } else {
        console.warn(`Received unknown data type from WebSocket: ${typeof event.data}`);
        if (typeof event.data === 'object') {
          console.warn(`Object properties: ${Object.keys(event.data).join(', ')}`);
        }
      }
    } catch (error) {
      console.error(`Error in WebSocket onmessage handler: ${error} | Stack: ${error.stack}`);
      onErrorCallback?.('Error processing server message');
    }
  };
};

const disconnect = () => {
  if (ws) {
    console.log('Disconnecting WebSocket...');
    ws.close();
    ws = null;
  }
};

const sendInitialSetup = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocketService: Cannot send setup - WebSocket not connected');
    return false;
  }
  
  try {
    // Create the setup message with just the model name
    // The Gemini Live API requires minimal setup - just the model name
    // Audio responses are enabled by default for live models
    const setupMessage = {
      setup: {
        model: MODEL_NAME
      }
    };
    
    // Log information about the setup message
    console.log(`WebSocketService: Sending initial setup to Gemini Live API: Model: ${MODEL_NAME}, Full setup message: ${JSON.stringify(setupMessage)}`);
    
    // Send the setup message as a JSON string
    ws.send(JSON.stringify(setupMessage));
    return true;
  } catch (error) {
    console.error(`WebSocketService: Error sending initial setup: ${error} | Stack: ${error.stack}`);
    return false;
  }
};

// Helper function to process binary data received from WebSocket
const processWebSocketBinaryData = (binaryData, ws, onMessageCallback, handleReceivedMessage) => {
  // Track binary data processing for debugging
  if (!window._binaryDataProcessed) window._binaryDataProcessed = 0;
  window._binaryDataProcessed++;
  
  console.log(`WebSocketService: Processing binary data #${window._binaryDataProcessed} | Data type: ${binaryData.constructor.name} | Size: ${(binaryData instanceof ArrayBuffer ? binaryData.byteLength : binaryData.size)} bytes`);
  
  // Determine if this is JSON or audio data
  // For JSON, we expect the first few bytes to be ASCII characters like '{', '"', etc.
  // For audio, we expect raw PCM data which will have different byte patterns
  
  // Convert to Uint8Array for inspection
  let bytes;
  if (binaryData instanceof ArrayBuffer) {
    bytes = new Uint8Array(binaryData);
    // console.log(`Converted ArrayBuffer to Uint8Array for inspection`);
  } else if (binaryData instanceof Blob) {
    // For Blob, we need to read it first
    console.log(`Need to read Blob data for inspection`);
    
    // Create a FileReader to read the Blob
    const reader = new FileReader();
    
    reader.onload = function() {
      const arrayBuffer = this.result;
      bytes = new Uint8Array(arrayBuffer);
      
      console.log(`Successfully read Blob data (${bytes.length} bytes)`);
      processBinaryBytes(bytes);
    };
    
    reader.onerror = function() {
      console.error(`Error reading Blob data:`, this.error);
    };
    
    // Start reading the Blob as ArrayBuffer
    reader.readAsArrayBuffer(binaryData);
    return; // Exit early, processing will continue in onload callback
  } else {
    console.error(`Unexpected binary data type: ${typeof binaryData}`);
    return;
  }
  
  // If we have bytes (from ArrayBuffer), process them immediately
  if (bytes) {
    processBinaryBytes(bytes);
  }
  
  // Inner function to process the binary bytes
  function processBinaryBytes(bytes) {
    // Log the first few bytes for debugging
    
    // Analyze byte patterns to determine if this is likely JSON or audio
    const looksLikeJson = bytes.length > 0 && (bytes[0] === 123 || bytes[0] === 91); // '{' or '['
    
    // For more detailed analysis, check for common JSON patterns
    let jsonConfidence = 0;
    if (bytes.length > 10) {
      // Check for ASCII printable characters in the first 20 bytes
      const printableCount = bytes.slice(0, 20).filter(b => b >= 32 && b <= 126).length;
      jsonConfidence = printableCount / Math.min(20, bytes.length);
      
      // console.log(`JSON confidence: ${(jsonConfidence * 100).toFixed(1)}% (${printableCount} printable chars in first ${Math.min(20, bytes.length)} bytes)`);
    }
    
    if (looksLikeJson || jsonConfidence > 0.7) {
      console.log(`Binary data appears to be JSON, converting to text`);
      
      // Convert binary to text and parse as JSON
      const textDecoder = new TextDecoder('utf-8');
      const jsonText = textDecoder.decode(bytes);
      
      // console.log(`Decoded text length: ${jsonText.length} characters`);
      
      try {
        const jsonData = JSON.parse(jsonText);
        // console.log(`Successfully parsed JSON with keys: ${Object.keys(jsonData).join(', ')}`);
        
        // Special handling for setup completion message
        if (jsonData.setupComplete !== undefined) {
          console.log('🤖 Received setup completion acknowledgment from Gemini Live API');
        }
        
        // Process the JSON message
        handleReceivedMessage(jsonData);
      } catch (error) {
        console.error(`Error parsing binary JSON data: ${error} | Raw JSON text: ${jsonText.substring(0, 200)}...`);
      }
    } else {
      // This is likely raw PCM audio data
      console.log('Binary data appears to be audio, analyzing patterns:');
      
      // Analyze audio patterns (for 16-bit PCM)
      if (bytes.length >= 100) {
        // Check for patterns typical of 16-bit PCM audio
        let nonZeroSamples = 0;
        let bigChanges = 0;
        
        // For 16-bit PCM, every 2 bytes form a sample
        for (let i = 0; i < 100; i += 2) {
          // Combine bytes to form 16-bit sample (little-endian)
          const sample = bytes[i] | (bytes[i+1] << 8);
          if (sample !== 0) nonZeroSamples++;
          
          // Check for big changes between adjacent samples (typical in audio)
          if (i >= 2) {
            const prevSample = bytes[i-2] | (bytes[i-1] << 8);
            if (Math.abs(sample - prevSample) > 1000) bigChanges++;
          }
        }
        
        console.log(` 🎛️🎛️ Audio analysis: ${nonZeroSamples}/50 non-zero samples, ${bigChanges}/49 big changes between samples | Data likely ${nonZeroSamples > 10 ? 'contains' : 'does NOT contain'} actual audio content`);
      }
      
      // Regardless of analysis, try to play it as audio
      console.log('Sending binary data to audio output service as raw PCM');
      onMessageCallback?.({ type: 'raw-pcm', data: binaryData instanceof ArrayBuffer ? binaryData : bytes.buffer });
    }
  }
};

// Placeholder for text input - might not be needed for pure audio streaming
const sendTextInput = (text) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not open. Cannot send text input.');
    return;
  }
  const textMessage = JSON.stringify({
    clientContent: {
      turns: [
        {
          role: 'USER',
          parts: [{ text: text }],
        },
      ],
      turnComplete: true, // Assuming text input completes a turn
    },
  });
  console.log('Sending text input:', textMessage);
  ws.send(textMessage);
};

/**
 * Sends audio data to the WebSocket.
 * According to the Gemini Live API documentation, we need to use a two-step process:
 * 1. Send a JSON message with realtimeInput.audio to announce we're sending audio
 * 2. Immediately follow with the raw PCM data as a binary frame
 * The audio data must be 16-bit PCM at 16kHz, mono, little-endian
 * @param {Uint8Array|ArrayBuffer} audioData - Raw audio bytes
 */
const sendAudioChunk = (audioBytes) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('WebSocketService: Cannot send audio - WebSocket not open');
    return;
  }

  // Ensure we have ArrayBuffer
  if (!(audioBytes instanceof ArrayBuffer)) {
    console.error('WebSocketService: sendAudioChunk requires ArrayBuffer, received:', typeof audioBytes);
    // Attempt conversion if possible (e.g., from Uint8Array or Blob) - add robust handling if needed
    return; // Stop if not ArrayBuffer
  }

  const startTime = Date.now(); // For performance tracking

  try {
    // Convert ArrayBuffer to Base64 string
    const base64Audio = Buffer.from(audioBytes).toString('base64');
    const base64Length = base64Audio.length;

    // Create the realtimeInput message with Base64 encoded audio
    const message = {
      realtimeInput: {
        audio: {
          mimeType: `audio/pcm;rate=${AUDIO_SAMPLE_RATE}`, // Explicitly set MIME type with sample rate
          data: base64Audio
        }
      }
    };

    // Increment the counter before sending
    audioChunkCounter++;

    // Log details before sending
    const durationMs = (audioBytes.byteLength / (AUDIO_SAMPLE_RATE * 2)) * 1000; // Assuming 16-bit PCM (2 bytes/sample)
    const now = new Date().toISOString();
    const firstBytes = Array.from(new Uint8Array(audioBytes.slice(0, 16))); // Log first few bytes

    console.log(`🔌🔌  WebSocketService: Sending audio chunk ArrayBuffer #${audioChunkCounter}`);

    // console.log(`🔌🔌  WebSocketService: Sending audio chunk ArrayBuffer #${audioChunkCounter} | Original size: ${audioBytes.byteLength} bytes | Duration: ${durationMs.toFixed(2)}ms (${(durationMs / 1000).toFixed(2)}s) | WebSocket state: ${ws.readyState} (OPEN) | Total audio chunks sent: ${audioChunkCounter}`);

    // Send the complete JSON message
    ws.send(JSON.stringify(message));

    // Log success and timing
    const endTime = Date.now();
    // console.log(`Successfully sent JSON payload with Base64 audio. Send operation took: ${endTime - startTime}ms`);

    // Update last sent time for response tracking
    window._lastAudioSentTime = endTime;

  } catch (error) {
    console.error(`WebSocketService: Error processing or sending audio chunk #${audioChunkCounter}: ${error} | Details: ${error.message} | Stack: ${error.stack}`);
    if (onErrorCallback) onErrorCallback('Error sending audio data');
  }
};

const handleReceivedMessage = (message) => {
  // Process received JSON messages from the Gemini Live API
  console.log('Processing JSON message from Gemini Live API');
  // console.log('Full message structure:', JSON.stringify(message, null, 2).substring(0, 500) + '...');
  
  // Track message types for debugging
  if (!window._receivedMessageTypes) window._receivedMessageTypes = {};
  
  // Identify the message type based on its structure
  let messageType = 'unknown';
  if (message.setupComplete !== undefined) messageType = 'setupComplete';
  else if (message.serverContent) messageType = 'serverContent';
  else if (message.event) messageType = 'event';
  else if (message.error) messageType = 'error';
  
  // Count message types
  window._receivedMessageTypes[messageType] = (window._receivedMessageTypes[messageType] || 0) + 1;
  console.log('Message types received so far:', JSON.stringify(window._receivedMessageTypes));
  
  // Handle setup completion acknowledgment
  if (message.setupComplete !== undefined) {
    console.log('Received setup completion acknowledgment. Ready for audio exchange.');
    setupCompleted = true;
    return;
  }
  
  // Handle event messages (transcript events)
  if (message.event) {
    console.log(`🪵 Received event message with properties: ${Object.keys(message.event).join(', ')}`);
    
    // Check for transcript events
    if (message.event.transcript) {
      const transcript = message.event.transcript;
      const isFinal = transcript.is_final || false;
      
      console.log(`🪵 🎙 ${isFinal ? 'FINAL' : 'Interim'} transcript: "${transcript.text}" | Is final: ${isFinal}`); // merged 2 logs
      
      // You could display this text in the UI or process it further
    }
    
    // Check for turn completion
    if (message.event.turnComplete) {
      console.log('🪵 ✅ Turn complete event received.');
      onTurnCompleteCallback?.();
    }
    
    return;
  }
  
  // Check for serverContent structure (main response container)
  if (message.serverContent) {
    console.log(`🪵 Received serverContent message with properties: ${Object.keys(message.serverContent).join(', ')}`);
    
    // Check for text responses
    if (
      message.serverContent.modelTurn &&
      message.serverContent.modelTurn.parts &&
      message.serverContent.modelTurn.parts.length > 0
    ) {
      console.log(`🪵 Found ${message.serverContent.modelTurn.parts.length} parts in modelTurn`);
      
      message.serverContent.modelTurn.parts.forEach((part, index) => {
        console.log(`🪵 Examining part ${index} with properties: ${Object.keys(part).join(', ')}`);
        
        // Handle text responses
        if (part.text) {
          console.log(`🪵 Received text response in part ${index}: ${part.text}`);
          // You could display this text in the UI
        }
        
        // Handle inline audio data (might be here instead of binary message)
        if (part.inlineData) {
          console.log(`🪵 Found inlineData in part ${index} with properties: ${Object.keys(part.inlineData).join(', ')}`);
          
          if (part.inlineData.mimeType && part.inlineData.data) {
            console.log(`🪵 Received inline audio data in part ${index}: MIME type: ${part.inlineData.mimeType} | Data length: ${part.inlineData.data.length} characters | Data type: ${typeof part.inlineData.data}`); // merged 4 logs
            
            // First few characters if it's a string
            if (typeof part.inlineData.data === 'string') {
              console.log(`🪵 First 20 chars of inline audio data in part ${index}: ${part.inlineData.data.substring(0, 20)}...`);
            }
            
            // Extract the data (it might be Base64 encoded)
            const base64AudioData = part.inlineData.data;
            const mimeType = part.inlineData.mimeType;
            
            // Decode the Base64 string into an ArrayBuffer
            try {
              const audioBuffer = Buffer.from(base64AudioData, 'base64');
              // Convert Node.js Buffer to ArrayBuffer for broader compatibility
              const arrayBuffer = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);
              
              console.log(`🪵 Successfully decoded Base64 audio to ArrayBuffer (${arrayBuffer.byteLength} bytes) | Sending decoded ArrayBuffer to audio output service`); // merged 2 logs
              
              // Pass the decoded ArrayBuffer and mimeType to the callback
              onMessageCallback?.({ type: 'audio', data: arrayBuffer, mimeType: mimeType });
            } catch (decodeError) {
              console.error(`🚨 Error decoding Base64 audio data: ${decodeError}`); onErrorCallback?.('Error decoding received audio'); // merged 1 log
            }
          } else {
            console.log(`🪵 inlineData in part ${index} is missing mimeType or data properties`);
          }
        }
      });
    } else {
      console.log('🪵 No modelTurn or parts found in serverContent');
    }

    // Check for interruptions
    if (message.serverContent.interrupted) {
      console.log('🪵 Server interruption detected.');
      onInterruptionCallback?.();
    }

    // Check for turn completion
    if (message.serverContent.turnComplete) {
      console.log('🪵 Server turn complete.');
      onTurnCompleteCallback?.();
    }
  } else {
    console.log('🪵 Received message without serverContent, event, or setupComplete structure');
  }

  // Handle errors if present in the message
  if (message.error) {
    console.error(`🚨 Received error message from server: ${message.error}`);
    onErrorCallback?.(message.error.message || 'Server error');
  }
};

// Callback registration methods
const setOnMessageCallback = (callback) => {
  onMessageCallback = callback;
};

const setOnStatusUpdateCallback = (callback) => {
  onStatusUpdateCallback = callback;
};

const setOnErrorCallback = (callback) => {
  onErrorCallback = callback;
};

const setOnInterruptionCallback = (callback) => {
  onInterruptionCallback = callback;
};

const setOnTurnCompleteCallback = (callback) => {
  onTurnCompleteCallback = callback;
};

// Returns true if the WebSocket is connected
const isConnected = () => {
  return ws && ws.readyState === WebSocket.OPEN;
};

// Returns true if the setup process has been completed
const isSetupComplete = () => {
  return setupCompleted;
};

const WebSocketService = {
  connect,
  disconnect,
  sendTextInput,
  sendAudioChunk,
  setOnMessageCallback,
  setOnStatusUpdateCallback,
  setOnErrorCallback,
  setOnInterruptionCallback,
  setOnTurnCompleteCallback,
  isConnected,
  isSetupComplete,
};

export default WebSocketService;
