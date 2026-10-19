export function useManagementRoomQuery() {
  const route = useRoute()
  return computed(() =>
    typeof route.query.roomId === 'string' ? { roomId: route.query.roomId } : {},
  )
}
