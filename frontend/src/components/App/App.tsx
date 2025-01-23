import React from "react";
import styles from "./App.module.scss";
import Sidebar from '@components/Sidebar/Sidebar.js';
import MainContent from '@components/MainContent/MainContent.js';
import ChatView from '@components/ChatView/ChatView.js';
import Header from '@components/Header/Header.js';

const App: React.FC = () => {
	return (
		<div className={styles.container}>
			<Header/>
			<div className={styles.mainSection}>
				<div className={styles.sidebarWrapper}>
        			<Sidebar />
      			</div>
        		<div className={styles.mainWrapper}>
          			<MainContent />
        		</div>
				<div className={styles.chatWrapper}>
					<ChatView />
				</div>
			</div>
		</div>
	);
};

export default App;
