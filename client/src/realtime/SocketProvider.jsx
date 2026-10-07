import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext';

const SocketContext = createContext(null);

const API_BASE = import.meta.env?.VITE_API_URL || 'http://localhost:3000';

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState('reconnecting');
  const socketRef = useRef(null);
  const subscribersRef = useRef(new Map());

  // Subscribe helper returning an unsubscribe function
  const subscribe = useCallback((event, handler) => {
    if (!subscribersRef.current.has(event)) {
      subscribersRef.current.set(event, new Set());
    }
    subscribersRef.current.get(event).add(handler);

    if (socketRef.current) {
      socketRef.current.on(event, handler);
    }

    return () => {
      const handlers = subscribersRef.current.get(event);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          subscribersRef.current.delete(event);
        }
      }
      if (socketRef.current) {
        socketRef.current.off(event, handler);
      }
    };
  }, []);

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setConnectionStatus('reconnecting');
      return;
    }

    // Exactly one socket per authenticated session
    const newSocket = io(API_BASE, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      setConnectionStatus('live');
    });

    newSocket.on('disconnect', () => {
      setConnectionStatus('reconnecting');
    });

    newSocket.on('connect_error', () => {
      setConnectionStatus('reconnecting');
    });

    // Attach all currently registered subscribers
    for (const [event, handlers] of subscribersRef.current.entries()) {
      for (const handler of handlers) {
        newSocket.on(event, handler);
      }
    }

    return () => {
      newSocket.disconnect();
      if (socketRef.current === newSocket) {
        socketRef.current = null;
      }
    };
  }, [token]);

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        connectionStatus,
        subscribe,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}
