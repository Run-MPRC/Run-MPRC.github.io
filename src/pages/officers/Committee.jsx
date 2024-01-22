import React from 'react';
import Header from '../../components/Header';
import HeaderImage from '../../images/committee/header_bg_5.jpg';
import Officer from '../../components/Officer';
import './committee.css';
import { COMMITTEE_INTRO, COMMITTEE_TITLE } from '../../text/Committee';

// const OfficerDefault = require('../../images/committee/committee_default_portrait.png');
const Officer1 = require('../../images/committee/frances_1.jpeg');
const Officer1Alt = require('../../images/committee/frances_2.jpg');
const Officer2 = require('../../images/committee/dave.png');
const Officer3 = require('../../images/committee/ted.jpg');
const Officer4 = require('../../images/committee/kat.jpg');
const Officer5 = require('../../images/committee/frank.jpg');
const Officer6 = require('../../images/committee/debbie.jpeg');
const Officer7 = require('../../images/committee/patti.jpg');
const Officer8 = require('../../images/committee/dalton.jpg');

const officers = [
  {
    id: 1,
    image: Officer1,
    imageAlt: Officer1Alt,
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
    name: 'Frank Markowitz',
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
  return (
    <>
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
