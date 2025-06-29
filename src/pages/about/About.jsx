import React from 'react';
import './about.css';
import { Link } from 'react-router-dom';
import SEO from '../../components/SEO';
import {
  ABOUT_MISSION_CONTENT,
  ABOUT_MISSION_TITLE,
  ABOUT_STORY_CONTENT,
  ABOUT_STORY_TITLE,
  JOIN_BUTTON,
} from '../../text/Home';

function About() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "About Mid-Peninsula Running Club",
    "description": "Learn about the Mid-Peninsula Running Club's history, mission, and community. Serving Bay Area runners on the San Francisco Peninsula since 1988 with weekly runs and social events.",
    "url": "https://run-mprc.github.io/about",
    "mainEntity": {
      "@type": "Organization",
      "name": "Mid-Peninsula Running Club",
      "description": "A running club serving the San Francisco Peninsula since 1988, emphasizing community, friendship, and supporting one another through running.",
      "foundingDate": "1988",
      "slogan": "Support One Another!",
      "mission": "Creating a running community where everyone feels encouraged and connected",
      "areaServed": [
        "San Mateo",
        "Foster City", 
        "Burlingame",
        "Belmont",
        "Redwood Shores",
        "Hillsborough",
        "San Carlos",
        "Millbrae",
        "Redwood City",
        "South San Francisco",
        "San Francisco",
        "Sunnyvale",
        "Los Gatos",
        "Fremont"
      ]
    }
  };

  return (
    <>
      <SEO 
        title="About Our Bay Area Running Club"
        description="Learn about the Mid-Peninsula Running Club's history, mission, and community. Serving Bay Area runners on the San Francisco Peninsula since 1988 with weekly runs and social events."
        keywords="about MPRC, Mid-Peninsula Running Club history, Bay Area running club mission, San Francisco Peninsula running community, running club since 1988, Support One Another running motto"
        url="https://run-mprc.github.io/about"
        canonicalUrl="https://run-mprc.github.io/about"
        structuredData={structuredData}
      />
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
          {JOIN_BUTTON}
        </Link>
      </section>
    </>
  );
}

export default About;
