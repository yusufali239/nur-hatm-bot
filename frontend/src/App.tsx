import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Award,
  BookOpen,
  CheckCircle2,
  Flame,
  Layers,
  RefreshCw,
  Share2,
  Shield,
  Sparkles,
  Trophy,
  XCircle,
} from 'lucide-react';
import { JuzCard } from './components/JuzCard';
import { RatingBoard } from './components/RatingBoard';
import { Timer } from './components/Timer';
import { AdminGlassPanel } from './components/AdminGlassPanel';
import {
  bookSelectedJuzs,
  completeBookedJuzs,
  fetchAppState,
  releaseBookedJuzs,
} from './lib/api';
import {
  getTelegramUserIdentity,
  initTelegramWebApp,
  triggerHaptic,
} from './lib/telegram';
import { FullStateResponse, HatmData, UserProfile } from './types';

type ActiveTab = 'hatm' | 'my' | 'rating' | 'admin';

export const App: React.FC = () => {
  // ... truncated for the call, but I need full content