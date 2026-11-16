import React from 'react';
import { Link } from 'react-router-dom';
import './joinUs.css';
import SEO from '../../components/SEO';
import MetaText from '../../components/MetaText';
import Header from '../../components/Header';
import HeaderImage from '../../images/joinus/header_bg_1.jpg';
import {
  JOIN_US_HEADING_DESC,
  RUN_WITH_US_TITLE,
  WAYS_TO_RUN,
  WAIVER_TITLE,
  WAIVER_TEXT,
} from '../../text/JoinUs';
import Card from '../../components/Card';
import {
  APPLE_CALENDAR_ICS_LINK,
  GOOGLE_CALENDAR_ADD_LINK,
  GOOGLE_MAPS_LOCATION_LINK,
  WAIVER_FORM_LINK,
} from '../../text/externalLinks';
import Route from './Route';
import Paragraph from '../../components/Paragraph';

const sectionMeeting = () => (
  <div className="head_desc">
    <h2 className="h2_joinus">{WAYS_TO_RUN}</h2>
    <Paragraph>{JOIN_US_HEADING_DESC}</Paragraph>
    <div className="joinus-buttons">
      <a
        href={GOOGLE_MAPS_LOCATION_LINK}
        className="btn directions-btn"
        target="_blank"
        rel="noopener noreferrer"
      >
        Get Directions To Our Meeting Location
      </a>
      <a
        href={GOOGLE_CALENDAR_ADD_LINK}
        className="btn calendar-btn"
        target="_blank"
        rel="noopener noreferrer"
      >
        Add to Google Calendar
      </a>
      <a href={APPLE_CALENDAR_ICS_LINK} className="btn calendar-btn">
        Add to Apple Calendar
      </a>
    </div>
  </div>
);

const sectionRouteMap = () => (
  <div className="route-map">
    <MetaText>Saturday Morning Route</MetaText>
    <Route />
  </div>
);

const sectionWaiver = () => (
  <Card className="joinus__card waiver-card">
    <h2 className="h2_joinus">{WAIVER_TITLE}</h2>
    <p className="waiver-note">
      <strong>All runners are required to sign the waiver form prior to running with the club.</strong>
    </p>
    <div className="waiver-text-container">
      {WAIVER_TEXT.trim().split('\n\n').map((paragraph, index) => (
        <p key={`waiver-p-${index}`} className="waiver-paragraph">
          {paragraph}
        </p>
      ))}
    </div>
    <div className="waiver-actions">
      <a
        href={WAIVER_FORM_LINK.replace('?embedded=true', '')}
        className="btn lg"
        target="_blank"
        rel="noopener noreferrer"
      >
        Sign Waiver Form
      </a>
    </div>
  </Card>
);

function RunWithUs() {
  return (
    <>
      <SEO
        title="Run With Us"
        description="Run with the Mid-Peninsula Running Club every Saturday morning at Seal Point Park in San Mateo. Find our meeting spot and route, and sign the club activity waiver before your first run."
        keywords="run with MPRC, Saturday group run San Mateo, Seal Point Park running, running club waiver, Bay Area group run"
        url="https://runmprc.com/run-with-us"
        canonicalUrl="https://runmprc.com/run-with-us"
      />
      <Header title={RUN_WITH_US_TITLE} image={HeaderImage} />
      <section className="joinus">
        <div className="container joinus__container">
          <div className="joinus__wrapper">
            {sectionMeeting()}
            <div className="waiver-section">
              <p className="waiver-required-notice">
                <strong>You must sign waiver below</strong>
              </p>
              {sectionWaiver()}
            </div>
            {sectionRouteMap()}
            <Paragraph>
              Want to become a member? See
              {' '}
              <Link className="hyperlink" to="/joinus">Join The Club</Link>
              {' '}
              for member benefits and the membership form.
            </Paragraph>
          </div>
        </div>
      </section>
    </>
  );
}

export default RunWithUs;
