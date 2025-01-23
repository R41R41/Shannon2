import { useState, useCallback } from 'react';

interface Position {
  x: number;
  y: number;
}

export const useContextMenu = () => {
  const [position, setPosition] = useState<Position | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setPosition(null);
  }, []);

  return {
    position,
    handleContextMenu,
    closeContextMenu,
  };
}; 