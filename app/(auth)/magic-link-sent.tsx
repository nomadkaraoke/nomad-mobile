import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function MagicLinkSentScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  // Normalize email param (could be array or undefined)
  const displayEmail = Array.isArray(email) ? email[0] || '' : email || '';

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={() => router.dismissAll()}
      >
        <Ionicons name="close" size={24} color="#6B7280" />
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="mail" size={64} color="#3B82F6" />
        </View>

        <Text style={styles.title}>Check Your Email</Text>
        <Text style={styles.subtitle}>
          We sent a magic link to{'\n'}
          <Text style={styles.email}>{displayEmail}</Text>
        </Text>

        <Text style={styles.instructions}>
          Click the link in the email to sign in. The link will expire in 15 minutes.
        </Text>

        <View style={styles.divider} />

        <Text style={styles.troubleTitle}>Didn't receive the email?</Text>
        <View style={styles.troubleList}>
          <Text style={styles.troubleItem}>
            {'\u2022'} Check your spam folder
          </Text>
          <Text style={styles.troubleItem}>
            {'\u2022'} Make sure you entered the correct email
          </Text>
        </View>

        <TouchableOpacity
          style={styles.resendButton}
          onPress={() => router.back()}
        >
          <Text style={styles.resendButtonText}>Try a different email</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
    padding: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
  },
  email: {
    fontWeight: '600',
    color: '#111827',
  },
  instructions: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#E5E7EB',
    marginBottom: 24,
  },
  troubleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
  },
  troubleList: {
    alignSelf: 'flex-start',
    marginBottom: 24,
  },
  troubleItem: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 24,
  },
  resendButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  resendButtonText: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '600',
  },
});
