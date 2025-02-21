import React, { useEffect, useState } from 'react';
import { SkillAgent } from '@/services/agents/skillAgent';
import { SkillInfo } from '@common/types/llm';
import styles from './SkillsTab.module.scss';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

interface SkillsTabProps {
  skill: SkillAgent | null;
}

const SkillsTab: React.FC<SkillsTabProps> = ({ skill }) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  useEffect(() => {
    if (skill) {
      skill.onUpdateSkills((newSkills) => {
        setSkills(newSkills);
      });
      skill.getSkills();
    }
  }, [skill]);

  const handleSkillClick = (skillName: string) => {
    setExpandedSkill(expandedSkill === skillName ? null : skillName);
  };

  return (
    <div className={styles.skillsContainer}>
      {skills.map((skill) => (
        <div
          key={skill.name}
          className={styles.skillCard}
          onClick={() => handleSkillClick(skill.name)}
        >
          <div className={styles.skillHeader}>
            <div className={styles.skillTitle}>
              <h3>{skill.name}</h3>
              {expandedSkill === skill.name ? (
                <KeyboardArrowUpIcon />
              ) : (
                <KeyboardArrowDownIcon />
              )}
            </div>
            <p className={styles.description}>{skill.description}</p>
          </div>
          {expandedSkill === skill.name && (
            <div className={styles.parameters}>
              {skill.parameters.map((param) => (
                <div key={param.name} className={styles.parameter}>
                  <div className={styles.paramName}>{param.name}</div>
                  <div className={styles.paramDesc}>{param.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default SkillsTab;
