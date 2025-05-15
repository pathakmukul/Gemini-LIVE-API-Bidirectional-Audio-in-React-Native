// components/TranscriptPopup.js
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const TranscriptPopup = ({ visible, onClose, transcripts = [] }) => {
  // Don't return null when not visible - instead manage visibility with style
  // This ensures the component is always mounted and sized properly
  
  useEffect(() => {
    if (visible) {
      console.log('TranscriptPopup visible with', transcripts.length, 'messages');
    }
  }, [visible, transcripts.length]);
  
  // Use the actual transcripts, no sample messages
  const displayTranscripts = transcripts;

  // Get screen dimensions to ensure proper sizing
  const { height } = Dimensions.get('window');
  
  return (
    <View style={[styles.container, { display: visible ? 'flex' : 'none' }]}>
      <View style={[styles.header, {marginTop: 40, marginHorizontal: 16}]}> 
        <Text style={styles.headerText}>Transcripts ({displayTranscripts.length})</Text>
        <TouchableOpacity 
          style={styles.closeButton}
          onPress={onClose}
        >
          <MaterialIcons name="close" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>
      <View style={[styles.messagesList, {flex: 1, marginHorizontal: 8, marginBottom: 24}]}> 
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.messagesContainer}
          showsVerticalScrollIndicator={true}
        >
          {displayTranscripts.length > 0 ? (
            displayTranscripts.map((message) => (
              <View 
                key={message.id}
                style={[
                  styles.messageBubble, 
                  message.type === 'user' ? styles.userBubble : styles.aiBubble,
                  !message.isFinal && styles.interimBubble
                ]}
              >
                <Text 
                  style={[
                    styles.messageText, 
                    message.type === 'user' ? styles.userText : styles.aiText,
                    !message.isFinal && styles.interimText
                  ]}
                >
                  {message.text}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyMessage}>No transcript messages yet. Start a conversation to see messages here.</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Set bottom to height of the button area to avoid overlap
    bottom: 150, // <-- Adjust this value if your control bar height changes
    backgroundColor: 'rgba(20, 20, 20, 0.98)', // slightly stronger modal effect
    zIndex: 9999,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(30, 30, 30, 0.9)',
  },
  headerText: {
    color: 'white',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  messagesList: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  messagesContainer: {
    padding: 20,
    paddingBottom: 30,
    minHeight: '100%',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 15,
    borderRadius: 20,
    marginBottom: 16,
    minHeight: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#4CAF50',
    borderBottomRightRadius: 4,
    marginLeft: 60,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#303030',
    borderBottomLeftRadius: 4,
    marginRight: 60,
  },
  interimBubble: {
    backgroundColor: '#3a3a3a',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#666',
    opacity: 0.8,
  },
  messageText: {
    fontSize: 17,
    lineHeight: 24,
  },
  userText: {
    color: 'white',
  },
  aiText: {
    color: 'white',
  },
  interimText: {
    color: '#ccc',
    fontStyle: 'italic',
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#999',
    marginTop: 30,
    fontSize: 16,
    fontStyle: 'italic',
  },
});

export default TranscriptPopup;
