// services/WebRTCAudioService.js
// Implementation of Acoustic Echo Cancellation using WebRTC

import { RTCPeerConnection, mediaDevices } from 'react-native-webrtc';
import { Platform } from 'react-native';
import { AEC_ENABLED, AGC_ENABLED, NS_ENABLED } from '../config';

// State variables
let webrtcInitialized = false;
let localStream = null;
let peerConnection = null;
let processingStarted = false;

/**
 * Initialize WebRTC audio processing with AEC
 * This leverages WebRTC's advanced AEC implementations
 * @returns {Promise<boolean>} Whether initialization was successful
 */
const initialize = async () => {
  if (webrtcInitialized) {
    console.log('WebRTCAudioService: Already initialized');
    return true;
  }

  try {
    console.log('WebRTCAudioService: Initializing WebRTC audio processing...');
    
    // Configure constraints to enable echo cancellation
    const constraints = {
      audio: {
        echoCancellation: AEC_ENABLED,     // Enable Acoustic Echo Cancellation
        echoCancellationType: 'system',    // Use the system's AEC implementation
        noiseSuppression: NS_ENABLED,      // Enable Noise Suppression
        autoGainControl: AGC_ENABLED,      // Enable Automatic Gain Control
        googEchoCancellation: AEC_ENABLED, // Chrome-specific
        googAutoGainControl: AGC_ENABLED,  // Chrome-specific
        googNoiseSuppression: NS_ENABLED,  // Chrome-specific
        googHighpassFilter: true,          // High-pass filter to remove low frequency noise
      },
      video: false // No video needed
    };
    
    // Get audio stream with echo cancellation enabled
    const stream = await mediaDevices.getUserMedia(constraints);
    
    // Store the stream for later use
    localStream = stream;
    
    // Create a loopback peer connection to activate audio processing
    await createLoopbackConnection();
    
    console.log('WebRTCAudioService: WebRTC audio processing initialized successfully');
    webrtcInitialized = true;
    return true;
  } catch (error) {
    console.error('WebRTCAudioService: Failed to initialize WebRTC audio processing:', error);
    return false;
  }
};

/**
 * Create a loopback connection to activate WebRTC audio processing
 * WebRTC only activates AEC when streams are connected
 * @returns {Promise<void>}
 */
const createLoopbackConnection = async () => {
  try {
    // Create peer connection with options for audio processing
    const rtcConfig = {
      sdpSemantics: 'unified-plan',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
    
    // Create the RTCPeerConnection with enforced audio processing
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    if (localStream) {
      // Add all audio tracks to the peer connection
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      // Create offer (SDP) to setup the connection
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      // Wait for ICE gathering to complete
      await new Promise(resolve => {
        if (peerConnection.iceGatheringState === 'complete') {
          resolve();
        } else {
          const checkState = () => {
            if (peerConnection.iceGatheringState === 'complete') {
              peerConnection.removeEventListener('icegatheringstatechange', checkState);
              resolve();
            }
          };
          peerConnection.addEventListener('icegatheringstatechange', checkState);
          
          // Set a timeout in case ICE gathering takes too long
          setTimeout(resolve, 1000);
        }
      });
      
      // Get the current local description after ICE candidates have been gathered
      const currentLocalDescription = peerConnection.localDescription;
      
      // Create a proper answer (manually adjusting the SDP if needed)
      // We'll fix the setup attribute issue by constructing a valid answer SDP
      let sdpLines = currentLocalDescription.sdp.split('\r\n');
      
      // Find and modify any problematic m= lines to ensure proper setup attributes
      const modifiedSdpLines = sdpLines.map(line => {
        // If this is a media section line (m=)
        if (line.startsWith('m=')) {
          return line;
        }
        // If this is a setup line with a problematic value
        if (line.includes('a=setup:')) {
          // For an answer, setup should be 'passive' if the offer was 'active'
          // or 'active' if the offer was 'passive'
          return 'a=setup:passive';
        }
        return line;
      });
      
      // Create proper answer with corrected SDP
      const answer = {
        type: 'answer',
        sdp: modifiedSdpLines.join('\r\n'),
      };
      
      try {
        await peerConnection.setRemoteDescription(answer);
        console.log('WebRTCAudioService: Remote description set successfully');
      } catch (setRemoteError) {
        console.error('WebRTCAudioService: Error setting remote description:', setRemoteError);
        
        // If that fails, try a simpler approach with a new RTCSessionDescription
        try {
          // Create a minimal valid answer SDP that should work
          const simpleSdp = sdpLines
            .filter(line => !line.includes('a=setup:')) // Remove problematic setup lines
            .join('\r\n');
          
          const simpleAnswer = {
            type: 'answer',
            sdp: simpleSdp,
          };
          
          await peerConnection.setRemoteDescription(simpleAnswer);
          console.log('WebRTCAudioService: Remote description set with simplified SDP');
        } catch (err) {
          // If even that fails, we'll have to avoid the loopback approach
          console.error('WebRTCAudioService: Failed to set simplified remote description:', err);
          throw new Error('Failed to create WebRTC loopback: ' + err.message);
        }
      }
      
      console.log('WebRTCAudioService: Loopback connection established to activate audio processing');
      processingStarted = true;
    } else {
      console.warn('WebRTCAudioService: No local stream available for loopback connection');
    }
  } catch (error) {
    console.error('WebRTCAudioService: Error creating loopback connection:', error);
  }
};

/**
 * Start audio processing with AEC
 * @returns {Promise<boolean>} Whether audio processing was started successfully
 */
const startAudioProcessing = async () => {
  try {
    // Make sure WebRTC is initialized
    if (!webrtcInitialized) {
      const initResult = await initialize();
      if (!initResult) {
        return false;
      }
    }
    
    // If processing is already started, nothing to do
    if (processingStarted) {
      console.log('WebRTCAudioService: Audio processing already active');
      return true;
    }
    
    // Create new loopback connection if needed
    if (!peerConnection || peerConnection.connectionState === 'closed') {
      await createLoopbackConnection();
    }
    
    console.log('WebRTCAudioService: Audio processing with AEC started');
    return true;
  } catch (error) {
    console.error('WebRTCAudioService: Error starting audio processing:', error);
    return false;
  }
};

/**
 * Stop audio processing and release resources
 * @returns {Promise<void>}
 */
const stopAudioProcessing = async () => {
  try {
    console.log('WebRTCAudioService: Stopping audio processing...');
    
    if (peerConnection) {
      // Close the peer connection
      peerConnection.close();
      peerConnection = null;
    }
    
    if (localStream) {
      // Stop all tracks and release the stream
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    processingStarted = false;
    webrtcInitialized = false;
    
    console.log('WebRTCAudioService: Audio processing stopped and resources released');
  } catch (error) {
    console.error('WebRTCAudioService: Error stopping audio processing:', error);
  }
};

/**
 * Check if audio processing with AEC is active
 * @returns {boolean}
 */
const isProcessingActive = () => {
  return processingStarted && webrtcInitialized;
};

export default {
  initialize,
  startAudioProcessing,
  stopAudioProcessing,
  isProcessingActive,
};
