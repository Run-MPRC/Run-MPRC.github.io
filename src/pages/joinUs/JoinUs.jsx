import React from 'react';
import { Link } from 'react-router-dom';
import './joinUs.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import SEO from '../../components/SEO';
import MetaText from '../../components/MetaText';
import {
  ARM,
  BECOME_A_MEMBER,
  GOOGLE_FORM,
  JOIN_US_BUTTON_2,
  JOIN_US_DESCRIPTION_4,
  JOIN_US_HEADING_DESC,
  LI_WHATSAPP_ACCESS,
  LI_FACEBOOK_STRAVA_ACCESS,
  LI_STORE_DISCOUNTS,
  LI_SOCIAL_RACE_ACTIVITIES,
  LI_RACE_DISCOUNT_CODES,
  LI_CLUB_LOGO_MERCHANDISE,
  LI_MONTHLY_NEWSLETTERS,
  LI_SATURDAY_CLUB_RUNS,
  LI_TRAIL_RUNS_TRACK,
  LI_CLUB_GATHERINGS,
  LI_CLUB_SUPPORT_NETWORKING,
  LI_AFFORDABLE_MEMBERSHIP_FEES,
  LI_EASY_ANNUAL_RENEWAL_PROCESS,
  LI_DISCOUNT_ON_SHOES,
  MEMBER_BENEFITS,
  WAYS_TO_RUN,
  WAIVER_TITLE,
  WAIVER_TEXT,
} from '../../text/JoinUs';
import Card from '../../components/Card';
import {
  ARM_URI,
  GOOGLE_FORM_LINK,
  GOOGLE_CALENDAR_ADD_LINK,
  GOOGLE_MAPS_LOCATION_LINK,
  WAIVER_FORM_LINK,
} from '../../text/externalLinks';
import Route from './Route';
import Paragraph from '../../components/Paragraph';

const sectionHeading = () => (
  <>
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
      </div>
    </div>
    <div className="route-map">
      <MetaText>Saturday Morning Route</MetaText>
      <Route />
    </div>
  </>
);

const sectionBecomeMember = () => (
  <Card className="joinus__card">
    <h2 className="h2_joinus">{BECOME_A_MEMBER}</h2>
    <ul className="ul_joinus">
      <li className="li_joinus">
        {JOIN_US_DESCRIPTION_4}
        <a className="hyperlink" href={GOOGLE_FORM_LINK} target="_blank" rel="noreferrer noopener">
          {GOOGLE_FORM}
          {' '}
          <FontAwesomeIcon icon={faGoogle} />
          .
          {' '}
        </a>
      </li>
      <li className="li_joinus">
        {MEMBER_BENEFITS}
        <ul className="ul_joinus">
          <li className="li_joinus">{LI_WHATSAPP_ACCESS}</li>
          <li className="li_joinus">{LI_FACEBOOK_STRAVA_ACCESS}</li>
          <li className="li_joinus">{LI_STORE_DISCOUNTS}</li>
          <li className="li_joinus">{LI_SOCIAL_RACE_ACTIVITIES}</li>
          <li className="li_joinus">{LI_RACE_DISCOUNT_CODES}</li>
          <li className="li_joinus">{LI_CLUB_LOGO_MERCHANDISE}</li>
          <li className="li_joinus">{LI_MONTHLY_NEWSLETTERS}</li>
          <li className="li_joinus">{LI_SATURDAY_CLUB_RUNS}</li>
          <li className="li_joinus">{LI_TRAIL_RUNS_TRACK}</li>
          <li className="li_joinus">{LI_CLUB_GATHERINGS}</li>
          <li className="li_joinus">{LI_CLUB_SUPPORT_NETWORKING}</li>
          <li className="li_joinus">{LI_AFFORDABLE_MEMBERSHIP_FEES}</li>
          <li className="li_joinus">{LI_EASY_ANNUAL_RENEWAL_PROCESS}</li>
          <li className="li_joinus">
            {LI_DISCOUNT_ON_SHOES}
            <a className="hyperlink" href={ARM_URI} target="_blank" rel="noreferrer noopener">
              {ARM}
            </a>
          </li>
        </ul>
      </li>
    </ul>
    <Link
      to={GOOGLE_FORM_LINK}
      className="btn lg"
      target="_blank"
      rel="noopener noreferrer"
    >
      {JOIN_US_BUTTON_2}
    </Link>
  </Card>
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

function JoinUs() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Join Mid-Peninsula Running Club',
    description: 'Join the Mid-Peninsula Running Club in San Mateo! Free to run with us every Saturday at Seal Point Park. Membership benefits include social events, race discounts and perks, volunteering opportunities, and a supportive Bay Area running community.',
    url: 'https://runmprc.com/joinus',
    mainEntity: {
      '@type': 'SportsOrganization',
      name: 'Mid-Peninsula Running Club',
      description: 'A running club serving the San Francisco Peninsula since 1988',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '1901 J Hart Clinton Dr',
        addressLocality: 'San Mateo',
        addressRegion: 'CA',
        postalCode: '94401',
        addressCountry: 'US',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: 37.5629,
        longitude: -122.3255,
      },
      event: {
        '@type': 'SportsEvent',
        name: 'Saturday Morning Run',
        description: 'Weekly group run at Seal Point Park',
        location: {
          '@type': 'Place',
          name: 'Seal Point Park',
          address: {
            '@type': 'PostalAddress',
            streetAddress: '1901 J Hart Clinton Dr',
            addressLocality: 'San Mateo',
            addressRegion: 'CA',
            postalCode: '94401',
            addressCountry: 'US',
          },
        },
        startTime: '09:00',
        dayOfWeek: 'Saturday',
        organizer: {
          '@type': 'Organization',
          name: 'Mid-Peninsula Running Club',
        },
      },
      offers: {
        '@type': 'Offer',
        price: '25',
        priceCurrency: 'USD',
        description: 'Annual membership fee for individuals (2026)',
      },
    },
  };

  return (
    <>
      <SEO
        title="Join Our Bay Area Running Club"
        description="Join the Mid-Peninsula Running Club in San Mateo! Free to run with us every Saturday at Seal Point Park. Membership benefits include social events, race discounts, and a supportive Bay Area running community."
        keywords="join running club, Bay Area running club membership, San Mateo running club join, Seal Point Park running, Saturday running group join, MPRC membership, running club benefits, Bay Area runners welcome"
        url="https://runmprc.com/joinus"
        canonicalUrl="https://runmprc.com/joinus"
        structuredData={structuredData}
      />
      <section className="joinus">
        <div className="container joinus__container">
          <div className="joinus__wrapper">
            {sectionWaiver()}
            {sectionHeading()}
            {sectionBecomeMember()}
          </div>
        </div>
      </section>
    </>
  );
}

export default JoinUs;
