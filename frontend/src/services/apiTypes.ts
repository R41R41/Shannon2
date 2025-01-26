const SERVER_IP_ADDRESS = import.meta.env.VITE_SERVER_IP_ADDRESS || 'localhost';

export const API_URL = `http://${SERVER_IP_ADDRESS}:5000/api`;

export const WS_URL = `ws://${SERVER_IP_ADDRESS}:5010`;
