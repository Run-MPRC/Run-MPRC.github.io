import React from 'react';
import Header from '../../components/Header';
import HeaderImage from '../../images/committee/header_bg_5.jpg';
import Officer from '../../components/Officer';
import SEO from '../../components/SEO';
import './committee.css';
import { COMMITTEE_INTRO, COMMITTEE_TITLE } from '../../text/Committee';

const OfficerDefault = require('../../images/committee/committee_default_portrait.png');
const OfficerJeanne = require('../../images/committee/jeanne.jpg');
const OfficerAndrea = require('../../images/committee/andrea_1.jpeg');
const OfficerDave = require('../../images/committee/dave.png');
const OfficerTed = require('../../images/committee/ted.jpg');
const OfficerAmy = require('../../images/committee/amy.jpeg');
const OfficerAllison = require('../../images/committee/allison.jpg');
const OfficerPatti = require('../../images/committee/patti.jpg');
const OfficerSarah = require('../../images/committee/sarah.jpg');

const officers = [
  {
    id: 1,
    image: OfficerDefault, // TODO: Add Kim G. photo
    name: 'Kim G.',
    job: 'Co-President',
  },
  {
    id: 2,
    image: OfficerJeanne,
    name: 'Jeanne L.',
    job: 'Co-President',
  },
  {
    id: 3,
    image: OfficerAndrea,
    name: 'Andrea B.',
    job: 'Co-Vice President',
  },
  {
    id: 4,
    image: OfficerDave,
    name: 'David L.',
    job: 'Co-Vice President',
  },
  {
    id: 5,
    image: OfficerTed,
    name: 'Ted L.',
    job: 'Treasurer',
  },
  {
    id: 6,
    image: OfficerAmy,
    name: 'Amy B.',
    job: 'Secretary',
  },
  {
    id: 7,
    image: OfficerAllison,
    name: 'Allison S.',
    job: 'Newsletter Editor',
  },
  {
    id: 8,
    image: OfficerPatti,
    name: 'Patty C.',
    job: 'Co-Social Director',
  },
  {
    id: 9,
    image: OfficerSarah,
    name: 'Sarah W.',
    job: 'Co-Social Director',
  },
];

function Committee() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'MPRC Committee and Leadership',
    description: 'Meet the Mid-Peninsula Running Club committee and leadership team. Our Bay Area running club is led by dedicated volunteers who organize weekly runs, social events, and community activities.',
    url: 'https://run-mprc.github.io/committee',
    mainEntity: {
      '@type': 'Organization',
      name: 'Mid-Peninsula Running Club',
      employee: [
        {
          '@type': 'Person',
          name: 'Kim G.',
          jobTitle: 'Co-President',
        },
        {
          '@type': 'Person',
          name: 'Jeanne L.',
          jobTitle: 'Co-President',
        },
        {
          '@type': 'Person',
          name: 'Andrea B.',
          jobTitle: 'Co-Vice President',
        },
        {
          '@type': 'Person',
          name: 'David L.',
          jobTitle: 'Co-Vice President',
        },
        {
          '@type': 'Person',
          name: 'Ted L.',
          jobTitle: 'Treasurer',
        },
        {
          '@type': 'Person',
          name: 'Amy B.',
          jobTitle: 'Secretary',
        },
        {
          '@type': 'Person',
          name: 'Allison S.',
          jobTitle: 'Newsletter Editor',
        },
        {
          '@type': 'Person',
          name: 'Patty C.',
          jobTitle: 'Co-Social Director',
        },
        {
          '@type': 'Person',
          name: 'Sarah W.',
          jobTitle: 'Co-Social Director',
        },
      ],
    },
  };

  return (
    <>
      <SEO
        title="Running Club Committee and Leadership"
        description="Meet the Mid-Peninsula Running Club committee and leadership team. Our Bay Area running club is led by dedicated volunteers who organize weekly runs, social events, and community activities."
        keywords="MPRC committee, running club leadership, Bay Area running club officers, Mid-Peninsula Running Club board, running club volunteers, San Mateo running club leadership"
        url="https://run-mprc.github.io/committee"
        canonicalUrl="https://run-mprc.github.io/committee"
        structuredData={structuredData}
      />
      <Header image={HeaderImage} title={COMMITTEE_TITLE}>
        {COMMITTEE_INTRO}
      </Header>
      <section className="officers">
        <div className="container officers__container">
          {officers.map(({
            id, image, name, job,
          }) => (
            <Officer
              key={id}
              image={image}
              name={name}
              job={job}
            />
          ))}
        </div>
      </section>
    </>
  );
}

export default Committee;
