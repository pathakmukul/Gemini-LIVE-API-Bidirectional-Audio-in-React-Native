# Gemini Live API Bidirectional Audio Streaming App

A React Native (Expo) application for real-time, bidirectional audio streaming with the Google Gemini Live API. Speak to Gemini and hear AI-powered responses played back through your device's main loudspeaker, enabling a natural, conversational experience.

---

## Features

- **Real-time Streaming:**
  - Streams microphone audio to Gemini Live API over WebSocket.
  - Receives and plays back Gemini's AI-generated audio responses instantly.

- **Speaker Routing:**
  - Uses `react-native-incall-manager` to force playback through the bottom-firing (loud) speakers, not the earpiece.

- **High Volume & Clarity:**
  - Ensures maximum volume and clear audio output.

- **Robust Audio Pipeline:**
  - Handles audio session activation, permissions, and resource cleanup.

---

## Architecture Overview

```
[User] <--> [AudioInputService] <--> [WebSocketService] <--> [Gemini Live API]
                                              |
                                    [AudioOutputService]
                                              |
                                    [Loudspeaker Output]
```

### Main Services
- **AudioInputService:** Captures and streams microphone audio in real-time.
- **WebSocketService:** Manages the bidirectional WebSocket connection with Gemini, handling both sending and receiving audio.
- **AudioOutputService:** Plays received audio using `expo-av` and routes it through the loudspeaker with `react-native-incall-manager`.
- **PermissionsService:** Handles runtime permissions for microphone and audio usage.

---
### Main Services in detail
1. AudioInputService.js
Purpose: Captures real-time audio from the device’s microphone.
How: Uses a voice processor (e.g., @picovoice/react-native-voice-processor) to record audio in short, raw PCM chunks.
Role: Streams these audio chunks to the WebSocket service for sending to the Gemini API.
2. WebSocketService.js
Purpose: Manages the bidirectional WebSocket connection with the Gemini Live API.
How:
Connects to the Gemini endpoint with the correct API key and model.
Sends an initial setup message to configure the model and audio parameters.
Streams microphone audio chunks (from AudioInputService) to Gemini in the required JSON+binary format.
Receives messages from Gemini, which may include audio (as PCM or Base64), text, or control signals.
Role: Acts as the bridge between your app’s audio pipeline and Gemini’s real-time AI.
3. AudioOutputService.js
Purpose: Handles playback of the audio responses received from Gemini.
How:
Converts received PCM audio chunks into WAV files for playback.
Uses expo-av to play the audio, but routes output through the loudspeaker using react-native-incall-manager.
Ensures maximum volume and manages audio session activation.
Maintains an audio queue to play chunks in sequence.
Cleans up resources (including InCallManager) when playback is done or the app is closed.
Role: Ensures the AI’s responses are heard clearly through the device’s main speaker.

---

## Setup & Installation

1. **Clone the repository:**
   ```sh
   git clone <your-repo-url>
   cd theApp
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Configure API Key and Model:**
   - Set your Google Gemini API key and model in `config.js`.

4. **Development Build (required for native modules):**
   - Make sure you have EAS CLI installed.
   - Build a development client:
     ```sh
     npx eas build --platform ios --profile development
     # or for Android
     npx eas build --platform android --profile development
     ```
   - Install the build on your device.

5. **Run the App:**
   ```sh
   npx expo start --dev-client
   # Scan the QR code with your development build
   ```

---

## Usage

- Press the microphone button (if present) to start speaking.
- Your voice is streamed to Gemini and you’ll hear the AI’s response played through the main speaker.
- All audio is routed through the loudspeaker for maximum clarity.

---

## Dependencies
- [expo-av](https://docs.expo.dev/versions/latest/sdk/av/) (audio playback)
- [react-native-incall-manager](https://github.com/zxcpoiu/react-native-incall-manager) (audio routing)
- [@picovoice/react-native-voice-processor](https://github.com/Picovoice/voice-processor) (audio capture)
- [expo-file-system](https://docs.expo.dev/versions/latest/sdk/filesystem/) (temp audio storage)

---

## Known Limitations
- **Audio Fragmentation:**
  - Playback may sound fragmented due to chunked streaming and limitations of expo-av. For seamless streaming, a lower-level audio API or native module would be required.
- **Native Build Required:**
  - Any time you add a new native dependency, you must rebuild the app with EAS or `expo run:ios`/`expo run:android`.

---

## License
MIT

---

## Credits
- Powered by Google Gemini Live API
- Built with Expo, React Native, and open source libraries
