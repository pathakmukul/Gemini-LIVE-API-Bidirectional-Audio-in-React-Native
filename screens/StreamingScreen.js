// screens/StreamingScreen.js
// Rule VI: Main UI Screen

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import WebSocketService from '../services/WebSocketService';
import AudioInputService from '../services/AudioInputService';
import AudioOutputService from '../services/AudioOutputService';
import PermissionsService from '../services/PermissionsService';

const StreamingScreen = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Disconnected');
  const [serverSpeaking, setServerSpeaking] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Create background dots only once when component mounts
  const backgroundDots = useMemo(() => {
    // Create a more structured distribution of dots
    const dots = [];
    
    // Create larger, more sparse bubbles in the background
    for (let i = 0; i < 12; i++) {
      // Divide the screen into a 4x3 grid for more even distribution
      const gridX = i % 4;
      const gridY = Math.floor(i / 4);
      
      // Add some randomness within each grid cell
      const offsetX = Math.random() * 20 - 10;
      const offsetY = Math.random() * 20 - 10;
      
      dots.push(
        <View 
          key={`bg-dot-${i}`} 
          style={[styles.textureDot, { 
            left: `${(gridX * 25) + offsetX + 12.5}%`, 
            top: `${(gridY * 33) + offsetY + 16.5}%`,
            opacity: 0.02 + (Math.random() * 0.02),
            width: 100 + (Math.random() * 150),
            height: 100 + (Math.random() * 150),
            borderRadius: 150,
          }]} 
        />
      );
    }
    
    // Add some smaller accent bubbles
    for (let i = 0; i < 15; i++) {
      dots.push(
        <View 
          key={`sm-dot-${i}`} 
          style={[styles.textureDot, { 
            left: `${Math.random() * 90 + 5}%`, 
            top: `${Math.random() * 90 + 5}%`,
            opacity: 0.01 + (Math.random() * 0.03),
            width: 20 + (Math.random() * 40),
            height: 20 + (Math.random() * 40),
            borderRadius: 30,
          }]} 
        />
      );
    }
    
    return dots;
  }, []);

  // --- WebSocket Callbacks --- START ---
  const handleWebSocketMessage = useCallback((audioData) => {
    setServerSpeaking(true); // Assume server starts speaking on first chunk
    AudioOutputService.playAudioChunk(audioData);
  }, []);

  const handleStatusUpdate = useCallback((status) => {
    console.log('UI: WebSocket status update:', status);
    setIsLoading(false);
    
    switch (status) {
      case 'connected':
        setIsConnected(true);
        setStatusMessage('Connected. Ready to record.');
        break;
      case 'disconnected':
        setIsConnected(false);
        setIsRecording(false); // Cannot record if not connected
        setStatusMessage('Disconnected');
        setServerSpeaking(false);
        AudioInputService.stopRecording(); // Ensure recording stops
        AudioOutputService.clearPlaybackQueue(); // Clear any remaining audio
        break;
      case 'error':
        setIsConnected(false);
        setIsRecording(false);
        setStatusMessage('Connection Error. Please try again.');
        setServerSpeaking(false);
        AudioInputService.stopRecording();
        AudioOutputService.clearPlaybackQueue();
        Alert.alert('Connection Error', 'Failed to connect to the audio service. Please try again.');
        break;
      default:
        setStatusMessage(`Status: ${status}`);
        break;
    }
  }, []);

  const handleError = useCallback((errorMsg) => {
    console.error('UI: WebSocket error:', errorMsg);
    setStatusMessage(`Error: ${errorMsg}`);
    setIsConnected(false);
    setIsRecording(false);
    setServerSpeaking(false);
    setIsLoading(false);
    AudioInputService.stopRecording();
    AudioOutputService.clearPlaybackQueue();
    Alert.alert('Error', errorMsg || 'An unknown error occurred');
  }, []);

  const handleInterruption = useCallback(() => {
    console.log('UI: Received interruption signal.');
    setStatusMessage('Server interrupted.');
    setServerSpeaking(false);
    AudioOutputService.clearPlaybackQueue();
  }, []);

  const handleTurnComplete = useCallback(() => {
    console.log('UI: Received turn complete signal.');
    setStatusMessage('Server turn complete.');
    setServerSpeaking(false);
  }, []);
  // --- WebSocket Callbacks --- END ---

  // --- Effect Hook for Setup/Cleanup --- START ---
  // Effect to automatically start recording when connected
  useEffect(() => {
    const startRecordingIfConnected = async () => {
      if (isConnected) {
        // Request permissions and start recording when connection is established
        const hasPermission = await requestPermission();
        
        if (hasPermission) {
          setStatusMessage('Starting audio capture...');
          setIsLoading(true);
          
          const success = await AudioInputService.startRecording();
          setIsRecording(success);
          setIsLoading(false);
          
          if (success) {
            setStatusMessage('Conversation active. Speak now!');
          } else {
            setStatusMessage('Connected, but audio capture failed.');
            Alert.alert('Audio Error', 'Failed to start audio capture. Please try again.');
          }
        } else {
          setStatusMessage('Connected, but microphone permission denied.');
          Alert.alert('Permission Denied', 'Microphone permission is required for this app to work.');
        }
      }
    };
    
    startRecordingIfConnected();
  }, [isConnected]);

  useEffect(() => {
    // Set callbacks for WebSocketService
    WebSocketService.setOnMessageCallback(handleWebSocketMessage);
    WebSocketService.setOnStatusUpdateCallback(handleStatusUpdate);
    WebSocketService.setOnErrorCallback(handleError);
    WebSocketService.setOnInterruptionCallback(handleInterruption);
    WebSocketService.setOnTurnCompleteCallback(handleTurnComplete);
    
    // Check for microphone permission on startup
    requestPermission();
    
    // Cleanup function when component unmounts
    return () => {
      console.log('UI: Cleaning up StreamingScreen...');
      WebSocketService.disconnect(); // Disconnect WebSocket
      AudioInputService.stopRecording(); // Stop recording if active
      AudioOutputService.clearPlaybackQueue(); // Clear audio queue
      // Clear callbacks to prevent memory leaks
      WebSocketService.setOnMessageCallback(null);
      WebSocketService.setOnStatusUpdateCallback(null);
      WebSocketService.setOnErrorCallback(null);
      WebSocketService.setOnInterruptionCallback(null);
      WebSocketService.setOnTurnCompleteCallback(null);
    };
    // Run only once on mount
  }, [handleWebSocketMessage, handleStatusUpdate, handleError, handleInterruption, handleTurnComplete]);
  // --- Effect Hook for Setup/Cleanup --- END ---

  // --- Button Handlers --- START ---
  const requestPermission = async () => {
    const granted = await PermissionsService.requestMicrophonePermission();
    setPermissionGranted(granted);
    if (!granted) {
      setStatusMessage('Microphone permission required for conversation.');
    }
    return granted;
  };

  // Mute/Unmute handlers
  const handleMuteToggle = async () => {
    if (!isMuted) {
      // Mute: Just set the mute flag in AudioInputService
      AudioInputService.setMuted(true);
      setIsMuted(true);
      setStatusMessage('Microphone muted. You can still listen.');
    } else {
      // Unmute: Clear the mute flag in AudioInputService
      AudioInputService.setMuted(false);
      setIsMuted(false);
      setStatusMessage('Microphone unmuted. Speak now!');
    }
  };

  // Single function to handle toggling conversation state
  const toggleConversation = async () => {
    if (!isConnected) {
      // Start conversation flow
      setStatusMessage('Starting conversation...');
      setIsLoading(true);
      
      // 1. Check permission first
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        setIsLoading(false);
        Alert.alert('Permission Required', 'Microphone permission is needed to use this app.');
        return;
      }
      
      // 2. Connect to WebSocket
      WebSocketService.connect();
      
      // The useEffect with the isConnected dependency will handle starting recording
    } else {
      // End conversation flow
      setStatusMessage('Ending conversation...');
      setIsLoading(true);
      
      // 1. Stop recording if active
      if (isRecording) {
        await AudioInputService.stopRecording();
        setIsRecording(false);
      }
      setIsMuted(false); // Reset mute state on stop
      
      // 2. Stop WebRTC audio processing
      const WebRTCAudioService = require('../services/WebRTCAudioService').default;
      if (WebRTCAudioService.isProcessingActive()) {
        await WebRTCAudioService.stopAudioProcessing();
        console.log('StreamingScreen: WebRTC audio processing stopped');
      }
      
      // 3. Disconnect WebSocket
      WebSocketService.disconnect(); 
      // This will trigger the status update callback which handles cleanup
      
      setServerSpeaking(false);
      setIsLoading(false);
    }
  };
  // --- Button Handlers --- END ---

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.backgroundTexture}>
        {/* Create subtle texture pattern with multiple semi-transparent dots */}
        {backgroundDots}
        <View style={styles.container}>
        <Text style={styles.title}>Live Audio Streaming</Text>

        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>Status: {statusMessage}</Text>
          {serverSpeaking && <Text style={styles.speakingText}>Server Speaking...</Text>}
          {isLoading && <ActivityIndicator size="small" color="#4CAF50" style={styles.loader} />}
        </View>

        <View style={styles.buttonContainer}>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.circleButton, {backgroundColor: !isConnected ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 99, 71, 0.9)"}]}
              onPress={toggleConversation}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <View style={styles.buttonGlow} />
              <Text style={[styles.buttonText, {color: !isConnected ? '#000000' : '#ffffff'}]}>{!isConnected ? "Start" : "Stop"}</Text>
            </TouchableOpacity>
            
            {isConnected && (
              <TouchableOpacity
                style={styles.muteButton}
                onPress={handleMuteToggle}
                disabled={isLoading}
                activeOpacity={0.7}
              >
                <MaterialIcons 
                  name={isMuted ? "mic-off" : "mic"} 
                  size={32} 
                  color={isMuted ? "#888" : "#ffffff"} 
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000000',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
  },
  muteButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    position: 'absolute',
    right: '15%', // Position in the center of the right side of the screen
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  backgroundTexture: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#121212',
    position: 'relative',
    overflow: 'hidden',
  },
  textureDot: {
    position: 'absolute',
    borderRadius: 100,
    backgroundColor: '#ffffff',
    zIndex: 1,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'transparent',
    position: 'relative',
    zIndex: 2,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 30,
    color: '#ffffff',
    textShadowColor: 'rgba(255, 255, 255, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  statusContainer: {
    marginBottom: 30,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    marginBottom: 10,
    color: '#e0e0e0',
    textAlign: 'center',
  },
  speakingText: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: 'bold',
    textShadowColor: 'rgba(76, 175, 80, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 50,
    alignItems: 'center',
    width: '100%',
  },
  circleButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: 'bold',
    zIndex: 2,
    letterSpacing: 0.5,
  },
  buttonGlow: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    opacity: 0.7,
  },
  loader: {
    marginTop: 10,
  }
});

export default StreamingScreen;
