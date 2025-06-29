import React from 'react';
import './activities.css';
import { Link } from 'react-router-dom';
import SEO from '../../components/SEO';
import HeaderImage from '../../images/activities/header_bg_1.jpg';
import Header from '../../components/Header';
import Subheader from '../../components/Subheader';
import Paragraph from '../../components/Paragraph';
import ImageCarousel from '../../components/ImageCarousel';

import Brunch1 from '../../images/activities/brunch1.jpeg';
import Brunch2 from '../../images/activities/brunch2.jpeg';
import Brunch3 from '../../images/activities/brunch3.jpeg';

import Activity1 from '../../images/activities/social1.jpeg';
import Activity2 from '../../images/activities/social2.jpeg';

import Extra1 from '../../images/activities/hangout_picnic.jpeg';
import Extra2 from '../../images/activities/hangout_volunteering.jpeg';
import Extra3 from '../../images/activities/hangout_costume.jpg';
import FlexColumnContainer from '../../components/FlexColumnContainer';
import VideoContainer from '../../components/VideoCarousel';

const brunchImages = [Brunch1, Brunch2, Brunch3];
const activityImages = [Activity1, Activity2];
const extraImages = [Extra1, Extra2, Extra3];
const videos = [
  'https://www.youtube.com/embed/Wf7stsuFcT8?si=eEHfx8PgP7NljpJW',
  'https://www.youtube.com/embed/EsuECjg4qng?si=i5RjsOhou5sjh8Gy',
];

function Activities() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "MPRC Activities and Events",
    "description": "Discover Mid-Peninsula Running Club activities: Saturday morning runs on the Bay Trail, social brunches, monthly gatherings, picnics, and special events for Bay Area runners.",
    "url": "https://run-mprc.github.io/activities",
    "mainEntity": {
      "@type": "Organization",
      "name": "Mid-Peninsula Running Club",
      "event": [
        {
          "@type": "SportsEvent",
          "name": "Saturday Morning Run",
          "description": "Weekly group run on the scenic Bay Trail near downtown San Mateo",
          "location": {
            "@type": "Place",
            "name": "Bay Trail",
            "address": {
              "@type": "PostalAddress",
              "addressLocality": "San Mateo",
              "addressRegion": "CA"
            }
          },
          "startTime": "09:00",
          "endTime": "10:00",
          "dayOfWeek": "Saturday",
          "organizer": {
            "@type": "Organization",
            "name": "Mid-Peninsula Running Club"
          }
        },
        {
          "@type": "SocialEvent",
          "name": "Club Brunch",
          "description": "Post-run brunch at local restaurants",
          "organizer": {
            "@type": "Organization",
            "name": "Mid-Peninsula Running Club"
          }
        },
        {
          "@type": "SocialEvent",
          "name": "Monthly Run Club Social",
          "description": "Monthly gathering with food and drinks on the last Saturday of each month",
          "organizer": {
            "@type": "Organization",
            "name": "Mid-Peninsula Running Club"
          }
        }
      ]
    }
  };

  return (
    <>
      <SEO 
        title="Running Club Activities and Events"
        description="Discover Mid-Peninsula Running Club activities: Saturday morning runs on the Bay Trail, social brunches, monthly gatherings, picnics, and special events for Bay Area runners."
        keywords="running club activities, Bay Trail running, Saturday running group, running club social events, Bay Area running events, MPRC activities, running club brunch, monthly running social"
        url="https://run-mprc.github.io/activities"
        canonicalUrl="https://run-mprc.github.io/activities"
        structuredData={structuredData}
      />
      <Header title="Activities" image={HeaderImage} />
      <FlexColumnContainer>
        <div className="first:mt-8">
          <Subheader title="Saturday Morning Runs" />
        </div>
        <Paragraph>
          Every Saturday morning, we run along the scenic Bay trail near downtown San Mateo.
          With the motto "Support One Another", we try to partner new members with a similar paced runner!
          Many of our members enjoy the company and conversations on their runs, and paces vary widely.
          We welcome runners of all paces as well as walkers (and their dogs).
          Even non-members are welcome to run with us as well, but yearly membership is only $15/year per person and $20 for the whole family.
          We use the money to help us book venues, pay for food, and buy supplies for our seasonal picnics and events.
          For more details on how to run with us, check out our
          {' '}
          <Link className="hyperlink" to="/joinus">Join Us</Link>
          {' '}
          page.
        </Paragraph>
        <Subheader title="Brunches" />
        <Paragraph>
          Our informal motto is &ldquo;The eating club with a running problem&rdquo;.
          We love to eat just as much as we love to run (probably more)!
          After most Saturday runs, we organize a group to try a different restaurant that we vote on.
          If you're looking for a group of food-enthusiasts, this might be the place!;
        </Paragraph>
        <ImageCarousel images={brunchImages} />
        <Subheader title="Run Club Socials" />
        <Paragraph>
          Celebrate the end of each month with our Run Club Socials!
          On the last Saturday of each month, our club members bring food and drink to share.
          These gatherings are a way for us to connect with other members over
          homemade baked goods, fruits, snacks, and refreshing beverages!
        </Paragraph>
        <ImageCarousel images={activityImages} />
        <h2 className="my-8">And sometimes, we just like to hang out…</h2>
        <Paragraph>
          We also host bi-annual club picnics for club members, volunteer at big races together,
          and have costumed runs on some holidays!
        </Paragraph>
        <ImageCarousel images={extraImages} />
        <h2 className="my-8">Experience the MPRC through these videos</h2>
        <VideoContainer videos={videos} />
      </FlexColumnContainer>
    </>
  );
}

export default Activities;
