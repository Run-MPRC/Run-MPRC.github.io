import React from 'react';
import Header from '../../components/Header';
import HeaderImage from '../../images/committee/header_bg_5.jpg';
import Officer from '../../components/Officer';
import SEO from '../../components/SEO';
import './committee.css';
import { COMMITTEE_INTRO, COMMITTEE_TITLE } from '../../text/Committee';

// const OfficerDefault = require('../../images/committee/committee_default_portrait.png');
const Officer1 = require('../../images/committee/frances.jpg');
/* const Officer1Alt = require('../../images/committee/frances_2.jpg'); */
const Officer2 = require('../../images/committee/dave.png');
const Officer3 = require('../../images/committee/ted.jpg');
const Officer4 = require('../../images/committee/kat.jpg');
const Officer5 = require('../../images/committee/allison.jpg');
const Officer6 = require('../../images/committee/debbie.jpg');
const Officer7 = require('../../images/committee/patti.jpg');
const Officer8 = require('../../images/committee/dalton.jpg');

const officers = [
  {
    id: 1,
    image: Officer1,
    /* imageAlt: Officer1Alt, */
    name: 'Frances Schulze',
    job: 'President' /* socials: [
      "https://instagram.com/",
      "https://twitter.com/",
      "https://facebook.com/",
      "https://linkedin.com/",
    ], */,
  },
  {
    id: 2,
    image: Officer2,
    name: 'David Liu',
    job: 'Vice President',
  },
  {
    id: 3,
    image: Officer3,
    name: 'Ted Levine',
    job: 'Treasurer',
  },
  {
    id: 4,
    image: Officer4,
    name: 'Kat Mar',
    job: 'Secretary',
  },
  {
    id: 5,
    image: Officer5,
    name: 'Allison Soung',
    job: 'Newsletter Editor',
  },
  {
    id: 6,
    image: Officer6,
    name: 'Debbie Mar',
    job: 'Social Director',
  },
  {
    id: 7,
    image: Officer7,
    name: 'Patti Chan',
    job: 'Social Director',
  },
  {
    id: 8,
    image: Officer8,
    name: 'Dalton Chan',
    job: 'Photographer',
  },
];

function Committee() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "MPRC Committee and Leadership",
    "description": "Meet the Mid-Peninsula Running Club committee and leadership team. Our Bay Area running club is led by dedicated volunteers who organize weekly runs, social events, and community activities.",
    "url": "https://run-mprc.github.io/committee",
    "mainEntity": {
      "@type": "Organization",
      "name": "Mid-Peninsula Running Club",
      "employee": [
        {
          "@type": "Person",
          "name": "Frances Schulze",
          "jobTitle": "President"
        },
        {
          "@type": "Person",
          "name": "David Liu",
          "jobTitle": "Vice President"
        },
        {
          "@type": "Person",
          "name": "Ted Levine",
          "jobTitle": "Treasurer"
        },
        {
          "@type": "Person",
          "name": "Kat Mar",
          "jobTitle": "Secretary"
        },
        {
          "@type": "Person",
          "name": "Allison Soung",
          "jobTitle": "Newsletter Editor"
        },
        {
          "@type": "Person",
          "name": "Debbie Mar",
          "jobTitle": "Social Director"
        },
        {
          "@type": "Person",
          "name": "Patti Chan",
          "jobTitle": "Social Director"
        },
        {
          "@type": "Person",
          "name": "Dalton Chan",
          "jobTitle": "Photographer"
        }
      ]
    }
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
            id, image, imageAlt, name, job, /* socials, */
          }) => (
            <Officer
              key={id}
              image={image}
              imageAlt={imageAlt}
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
