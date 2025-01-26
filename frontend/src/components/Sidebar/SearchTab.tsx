import React, { useState, useEffect } from 'react';
import styles from './SearchTab.module.scss';
import MonitoringService, { LogEntry } from '@/services/monitoring';

interface SearchTabProps {
  searchResults: LogEntry[];
  setSearchResults: (results: LogEntry[]) => void;
}

const SearchTab: React.FC<SearchTabProps> = ({
  searchResults,
  setSearchResults,
}) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [platform, setPlatform] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    const monitoring = MonitoringService();
    const unsubscribe = monitoring.onSearchResults((results) => {
      setSearchResults(results);
    });

    return () => {
      unsubscribe();
    };
  }, [setSearchResults]);

  // 検索条件が変更されるたびに検索を実行
  useEffect(() => {
    const monitoring = MonitoringService();
    monitoring.searchLogs({
      startDate,
      endDate,
      platform,
      content,
    });
  }, [startDate, endDate, platform, content]);

  const formatContent = (content: string) => {
    return content.split('\n').map((line, i) => (
      <React.Fragment key={i}>
        {line}
        {i < content.split('\n').length - 1 && <br />}
      </React.Fragment>
    ));
  };

  return (
    <div className={styles.container}>
      <span className={styles.title}>検索</span>
      <div className={styles.searchForm}>
        <input
          type="text"
          onFocus={(e) => (e.target.type = 'datetime-local')}
          onBlur={(e) => {
            if (!e.target.value) e.target.type = 'text';
          }}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          placeholder="開始日時"
          className={styles.input}
        />
        <input
          type="text"
          onFocus={(e) => (e.target.type = 'datetime-local')}
          onBlur={(e) => {
            if (!e.target.value) e.target.type = 'text';
          }}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder="終了日時"
          className={styles.input}
        />
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className={`${styles.input} ${styles.select}`}
        >
          <option value="">全てのプラットフォーム</option>
          <option value="web">Web</option>
          <option value="discord">Discord</option>
          <option value="minecraft">Minecraft</option>
          <option value="twitter">Twitter</option>
          <option value="youtube">YouTube</option>
        </select>
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="検索キーワード"
        />
      </div>
      <div className={styles.results}>
        {searchResults.map((log, index) => (
          <div key={index} className={styles.logEntry}>
            <div className={styles.logHeader}>
              <span className={styles.timestamp}>{log.timestamp}</span>
              <span className={styles.platform}>{log.platform}</span>
            </div>
            <span className={`${styles.content} ${styles[log.color]}`}>
              {formatContent(log.content)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SearchTab;
