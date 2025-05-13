// screens/StreamingScreen.js
// Rule VI: Main UI Screen

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Button, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import WebSocketService from '../services/WebSocketService';
import AudioInputService from '../services/AudioInputService';
import AudioOutputService from '../services/AudioOutputService';
import PermissionsService from '../services/PermissionsService';

const StreamingScreen = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Disconnected');
  const [serverSpeaking, setServerSpeaking] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
      
      // 2. Disconnect WebSocket
      WebSocketService.disconnect(); 
      // This will trigger the status update callback which handles cleanup
      
      setServerSpeaking(false);
      setIsLoading(false);
    }
  };
  // --- Button Handlers --- END ---

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Live Audio Streaming</Text>

        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>Status: {statusMessage}</Text>
          {serverSpeaking && <Text style={styles.speakingText}>Server Speaking...</Text>}
          {isLoading && <ActivityIndicator size="small" color="#4CAF50" style={styles.loader} />}
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title={!isConnected ? "Start Conversation" : "End Conversation"}
            onPress={toggleConversation}
            color={!isConnected ? "#4CAF50" : "#FF6347"}
            disabled={isLoading}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
  },
  statusContainer: {
    marginBottom: 30,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    marginBottom: 10,
  },
  speakingText: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 300,
  },
  loader: {
    marginTop: 10,
  }
});

export default StreamingScreen;
