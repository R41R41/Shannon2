import React, { useState, useEffect } from 'react';
import styles from './SearchTab.module.scss';
import { ILog } from '@common/types';
import { MemoryZone } from '@common/types';
import { MonitoringAgent } from '@/services/agents/monitoringAgent';

interface SearchTabProps {
  monitoring: MonitoringAgent | null;
  searchResults: ILog[];
  setSearchResults: (results: ILog[]) => void;
}

const SearchTab: React.FC<SearchTabProps> = ({
  monitoring,
  searchResults,
  setSearchResults,
}) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [memoryZone, setMemoryZone] = useState<MemoryZone | ''>('');
  const [content, setContent] = useState('');

  useEffect(() => {
    const unsubscribe = monitoring?.onSearchResults((results) => {
      setSearchResults(results);
    });

    return () => {
      unsubscribe?.();
    };
  }, [setSearchResults, monitoring]);

  // 検索条件が変更されるたびに検索を実行
  useEffect(() => {
    monitoring?.searchLogs({
      startDate,
      endDate,
      memoryZone,
      content,
    });
  }, [startDate, endDate, memoryZone, content, monitoring]);

  const formatContent = (content: string) => {
    return content.split('\n').map((line, i) => (
      <React.Fragment key={i}>
        {line}
        {i < content.split('\n').length - 1 && <br />}
      </React.Fragment>
    ));
  };

  const formatTimestamp = (timestamp: Date) => {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(new Date(timestamp))
      .replace(/\//g, '-');
  };

  return (
    <div className={styles.container}>
      <span className={styles.title}>Search Logs</span>
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
          value={memoryZone}
          onChange={(e) => setMemoryZone(e.target.value as MemoryZone)}
          className={`${styles.input} ${styles.select}`}
        >
          <option value="">全ての記憶領域</option>
          <option value="web">ShannonUI</option>
          <option value="discord:toyama_server">discord:とやまさば</option>
          <option value="discord:aiminelab_server">
            discord:アイマイラボ！
          </option>
          <option value="discord:test_server">
            discord:シャノンテスト用サーバー
          </option>
          <option value="minecraft">minecraft</option>
          <option value="twitter:schedule_post">
            twitter:スケジュール投稿
          </option>
          <option value="twitter:post">twitter:通常投稿</option>
          <option value="youtube">youtube</option>
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
              <span className={styles.timestamp}>
                {formatTimestamp(log.timestamp)}
              </span>
              <span className={styles.platform}>{log.memoryZone}</span>
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
