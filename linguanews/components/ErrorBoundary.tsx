import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { clearAuthState } from '../services/auth';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// Without this, an uncaught render error anywhere in the tree unmounts the
// whole app with no fallback and no visible message (especially in release
// builds) — the screen keeps showing its last paint but nothing responds,
// including navigating to Settings to sign out. This gives the user a way
// out instead of a permanently dead screen.
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
  };

  handleSignOut = async () => {
    await clearAuthState();
    this.setState({ error: null });
    router.replace('/login');
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReload}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={this.handleSignOut}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Sign out</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  message: { fontSize: 14, color: '#666', textAlign: 'center' },
  button: { backgroundColor: '#3b82f6', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#e11d48' },
  secondaryButtonText: { color: '#e11d48' },
});
