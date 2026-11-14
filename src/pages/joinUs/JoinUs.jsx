import React from 'react';
import { Link } from 'react-router-dom';
import './joinUs.css';
import SEO from '../../components/SEO';
import {
  ARM,
  BECOME_A_MEMBER,
  GOOGLE_FORM,
  JOIN_US_BUTTON_2,
  JOIN_US_DESCRIPTION_4,
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
} from '../../text/JoinUs';
import Card from '../../components/Card';
import {
  ARM_URI,
  MEMBERSHIP_FORM_LINK,
} from '../../text/externalLinks';
import Paragraph from '../../components/Paragraph';

const sectionBecomeMember = () => (
  <Card className="joinus__card">
    <h2 className="h2_joinus">{BECOME_A_MEMBER}</h2>
    <ul className="ul_joinus">
      <li className="li_joinus">
        {JOIN_US_DESCRIPTION_4}
        <a className="hyperlink" href={MEMBERSHIP_FORM_LINK} target="_blank" rel="noreferrer noopener">
          {GOOGLE_FORM}
        </a>
        .
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
    <a
      href={MEMBERSHIP_FORM_LINK}
      className="btn lg"
      target="_blank"
      rel="noopener noreferrer"
    >
      {JOIN_US_BUTTON_2}
    </a>
  </Card>
);

function JoinUs() {
  const year = new Date().getFullYear();
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
        startDate: `${year}-01-01T09:00:00-08:00`,
        endDate: `${year}-12-31T10:00:00-08:00`,
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
            {sectionBecomeMember()}
            <Paragraph>
              Not a member yet? Everyone is welcome to run with us. See
              {' '}
              <Link className="hyperlink" to="/run-with-us">Run With Us</Link>
              {' '}
              for where we meet and the club activity waiver.
            </Paragraph>
          </div>
        </div>
      </section>
    </>
  );
}

export default JoinUs;
