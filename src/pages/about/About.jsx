import React from 'react';
import './about.css';
import { Link } from 'react-router-dom';
import {
  ABOUT_MISSION_CONTENT,
  ABOUT_MISSION_TITLE,
  ABOUT_STORY_CONTENT,
  ABOUT_STORY_TITLE,
  JOINBUTTON,
} from '../../text/Home';

function About() {
  return (
    <>
      <section className="about__story">
        <div className="container about__story-container">
          <div className="about__section-content">
            <h2>{ABOUT_STORY_TITLE}</h2>
            {ABOUT_STORY_CONTENT.map((paragraph, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <p key={`story-paragraph-${index}`}>{paragraph}</p>
            ))}
          </div>
        </div>
      </section>
      <section className="about__mission">
        <div className="container about__mission-container">
          <div className="about__section-content">
            <h2>{ABOUT_MISSION_TITLE}</h2>
            {ABOUT_MISSION_CONTENT.map((paragraph, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <p key={`mission-paragraph-${index}`}>{paragraph}</p>
            ))}
          </div>
        </div>
      </section>

      <section className="join_btn_section">
        <Link to="/joinus" className="btn lg">
          {JOINBUTTON}
        </Link>
      </section>
    </>
  );
}

export default About;
