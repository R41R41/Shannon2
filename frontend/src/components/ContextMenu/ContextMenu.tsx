import React, { useEffect } from 'react';
import styles from './ContextMenu.module.scss';

interface MenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: MenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose }) => {
  useEffect(() => {
    const handleClickOutside = () => onClose();
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [onClose]);

  return (
    <div 
      className={styles.contextMenu}
      style={{ 
        left: position.x, 
        top: position.y 
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => (
        <button
          key={index}
          className={styles.menuItem}
          onClick={item.onClick}
          disabled={item.disabled}
        >
          {item.icon && <span className={styles.icon}>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
};

export default ContextMenu; 