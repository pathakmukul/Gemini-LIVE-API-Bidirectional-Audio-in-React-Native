// services/PermissionsService.js
// Rule V: Permissions Service

import { PermissionsAndroid, Platform } from 'react-native';
import { Audio } from 'expo-av';

const requestMicrophonePermission = async () => {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message:
            'This app needs access to your microphone to stream audio.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        console.log('PermissionsService: Microphone permission granted (Android)');
        return true;
      } else {
        console.log('PermissionsService: Microphone permission denied (Android)');
        return false;
      }
    } catch (err) {
      console.warn('PermissionsService: Error requesting microphone permission (Android):', err);
      return false;
    }
  } else if (Platform.OS === 'ios') {
    try {
      // Request permissions using expo-av
      const result = await Audio.requestPermissionsAsync();
      const granted = result.granted || result.status === 'granted';
      console.log(`PermissionsService: Microphone permission ${granted ? 'granted' : 'denied'} (iOS)`);
      return granted;
    } catch (err) {
      console.warn('PermissionsService: Error requesting microphone permission (iOS):', err);
      return false;
    }
  }
  // Other platforms not handled
  return false;
};

export default {
  requestMicrophonePermission,
};
