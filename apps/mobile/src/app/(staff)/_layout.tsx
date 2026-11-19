import { Stack } from 'expo-router';
import { RoleGate } from '../../components/RoleGate';

export default function StaffLayout() {
  return (
    <RoleGate role="staff">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleGate>
  );
}
