import React from 'react';
import { Link } from 'react-router-dom';
import './joinUs.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle /* , faMeetup */ } from '@fortawesome/free-brands-svg-icons';
import SEO from '../../components/SEO';
import MetaText from '../../components/MetaText';
import {
  ARM,
  BECOME_A_MEMBER,
  GOOGLE_FORM,
  JOIN_US_BUTTON_1,
  JOIN_US_BUTTON_2,
  JOIN_US_DESCRIPTION_1,
  JOIN_US_DESCRIPTION_2,
  JOIN_US_DESCRIPTION_3,
  JOIN_US_DESCRIPTION_4,
  JOIN_US_DESCRIPTION_5,
  JOIN_US_HEADING_DESC,
  JUST_RUN_WITH_US,
  JUST_RUN_WITH_US_CONTENT_1,
  JUST_RUN_WITH_US_CONTENT_2,
  JUST_RUN_WITH_US_CONTENT_3,
  LI_ACCESS_TO_STRAVA_FACEBOOK,
  LI_AFFORDABLE_MEMBERSHIP_FEES,
  LI_CLUB_GATHERINGS,
  LI_CLUB_LOGO_MERCHANDISE,
  LI_CLUB_SUPPORT_NETWORKING,
  LI_DISCOUNT_ON_SHOES,
  LI_EASY_ANNUAL_RENEWAL_PROCESS,
  LI_MONTHLY_NEWSLETTERS,
  LI_RACE_DISCOUNT_CODES,
  LI_SATURDAY_CLUB_RUNS,
  LI_SOCIAL_RACE_ACTIVITIES,
  /* MEETUP_GROUP, */
  MEMBER_BENEFITS,
  WAYS_TO_RUN,
} from '../../text/JoinUs';
import Card from '../../UI/Card';
import { ARM_URI, GOOGLE_FORM_LINK /* , MEETUP_URI */ } from '../../text/externalLinks';
import Route from './Route';
import Paragraph from '../../components/Paragraph';

const sectionHeading = () => (
  <>
    <div className="head_desc">
      <h2 className="h2_joinus">{WAYS_TO_RUN}</h2>
      <Paragraph>{JOIN_US_HEADING_DESC}</Paragraph>
    </div>
    <div className="route-map">
      <MetaText>Saturday Morning Route</MetaText>
      <Route />
    </div>
  </>
);

const sectionRunWithUs = () => (
  <Card className="joinus__card">
    <h2 className="h2_joinus">
      {JUST_RUN_WITH_US}
    </h2>
    <ul className="ul_joinus">
      <li className="li_joinus">{JUST_RUN_WITH_US_CONTENT_1}</li>
      <li className="li_joinus">{JUST_RUN_WITH_US_CONTENT_2}</li>
      <li className="li_joinus">{JUST_RUN_WITH_US_CONTENT_3}</li>
    </ul>
  </Card>
);

// 2025-06-07: Meetup is no longer used for club activities.
// const sectionMeetup = () => (
//   <Card className="joinus__card">
//     <h2 className="h2_joinus">
//       {JOIN_US_DESCRIPTION_1}
//       <a className="hyperlink" href={MEETUP_URI} target="_blank" rel="noreferrer noopener">
//         {MEETUP_GROUP}
//         {' '}
//         <FontAwesomeIcon icon={faMeetup} />
//       </a>
//     </h2>
//     <ul className="ul_joinus">
//       <li className="li_joinus">{JOIN_US_DESCRIPTION_2}</li>
//       <li className="li_joinus">{JOIN_US_DESCRIPTION_3}</li>
//     </ul>
//     <Link
//       to={MEETUP_URI}
//       className="btn lg"
//       target="_blank"
//       rel="noopener noreferrer"
//     >
//       {JOIN_US_BUTTON_1}
//     </Link>
//   </Card>
// );

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
      <li className="li_joinus">{JOIN_US_DESCRIPTION_5}</li>
      <li className="li_joinus">
        {MEMBER_BENEFITS}
        <ul className="ul_joinus">
          <li className="li_joinus">{LI_SATURDAY_CLUB_RUNS}</li>
          <li className="li_joinus">{LI_CLUB_SUPPORT_NETWORKING}</li>
          <li className="li_joinus">{LI_CLUB_GATHERINGS}</li>
          <li className="li_joinus">{LI_MONTHLY_NEWSLETTERS}</li>
          <li className="li_joinus">{LI_CLUB_LOGO_MERCHANDISE}</li>
          <li className="li_joinus">{LI_SOCIAL_RACE_ACTIVITIES}</li>
          <li className="li_joinus">{LI_RACE_DISCOUNT_CODES}</li>
          <li className="li_joinus">
            {LI_DISCOUNT_ON_SHOES}
            <a className="hyperlink" href={ARM_URI} target="_blank" rel="noreferrer noopener">
              {ARM}
            </a>
          </li>
          <li className="li_joinus">{LI_ACCESS_TO_STRAVA_FACEBOOK}</li>
          <li className="li_joinus">{LI_AFFORDABLE_MEMBERSHIP_FEES}</li>
          <li className="li_joinus">{LI_EASY_ANNUAL_RENEWAL_PROCESS}</li>
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

function JoinUs() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Join Mid-Peninsula Running Club",
    "description": "Join the Mid-Peninsula Running Club in San Mateo! Free to run with us every Saturday at Seal Point Park. Membership benefits include social events, race discounts and perks, volunteering opportunities, and a supportive Bay Area running community.",
    "url": "https://run-mprc.github.io/joinus",
    "mainEntity": {
      "@type": "SportsOrganization",
      "name": "Mid-Peninsula Running Club",
      "description": "A running club serving the San Francisco Peninsula since 1988",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "1901 J Hart Clinton Dr",
        "addressLocality": "San Mateo",
        "addressRegion": "CA",
        "postalCode": "94401",
        "addressCountry": "US"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": 37.5629,
        "longitude": -122.3255
      },
      "event": {
        "@type": "SportsEvent",
        "name": "Saturday Morning Run",
        "description": "Weekly group run at Seal Point Park",
        "location": {
          "@type": "Place",
          "name": "Seal Point Park",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "1901 J Hart Clinton Dr",
            "addressLocality": "San Mateo",
            "addressRegion": "CA",
            "postalCode": "94401",
            "addressCountry": "US"
          }
        },
        "startTime": "09:00",
        "dayOfWeek": "Saturday",
        "organizer": {
          "@type": "Organization",
          "name": "Mid-Peninsula Running Club"
        }
      },
      "offers": {
        "@type": "Offer",
        "price": "15",
        "priceCurrency": "USD",
        "description": "Annual membership fee for individuals"
      }
    }
  };

  return (
    <>
      <SEO 
        title="Join Our Bay Area Running Club"
        description="Join the Mid-Peninsula Running Club in San Mateo! Free to run with us every Saturday at Seal Point Park. Membership benefits include social events, race discounts, and a supportive Bay Area running community."
        keywords="join running club, Bay Area running club membership, San Mateo running club join, Seal Point Park running, Saturday running group join, MPRC membership, running club benefits, Bay Area runners welcome"
        url="https://run-mprc.github.io/joinus"
        canonicalUrl="https://run-mprc.github.io/joinus"
        structuredData={structuredData}
      />
      <section className="joinus">
        <div className="container joinus__container">
          <div className="joinus__wrapper">
            {sectionHeading()}
            &nbsp;&nbsp;
            {sectionRunWithUs()}
            &nbsp;&nbsp;
            {/* {sectionMeetup()} */}
            &nbsp;&nbsp;
            {sectionBecomeMember()}
            &nbsp;&nbsp;
          </div>
        </div>
      </section>
    </>
  );
}

export default JoinUs;
