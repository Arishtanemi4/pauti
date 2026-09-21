import { useColorScheme } from 'react-native';
import { Theme, themes } from './tokens';

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return themes[scheme === 'dark' ? 'dark' : 'light'];
}
