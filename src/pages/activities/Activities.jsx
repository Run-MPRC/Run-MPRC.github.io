import React from 'react';
import './activities.css';
import { Link } from 'react-router-dom';
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
  return (
    <>
      <Header title="Activities" image={HeaderImage} />
      <FlexColumnContainer>
        <div className="first:mt-8">
          <Subheader title="Saturday Morning Runs" />
        </div>
        <Paragraph>
          Every Saturday morning, we run along the scenic Bay trail near downtown San Mateo.
          We welcome runners of all paces as well as walkers.
          Non-members are welcome to run with us.
          For more details on how to run with us, check out our
          {' '}
          <Link className="hyperlink" to="/joinus">Join Us</Link>
          {' '}
          page.
        </Paragraph>
        <Subheader title="Brunches" />
        <Paragraph>
          &ldquo;Our informal motto is &ldquo;the eating club with a running problem&rdquo;.
          We love to eat just as much as we love to run (or more)!
          After most Saturday runs, we organize a group to try brunch at nearby places.&rdquo;
        </Paragraph>
        <ImageCarousel images={brunchImages} />
        <Subheader title="Run Club Socials" />
        <Paragraph>
          Celebrate the end of each month with our Run Club Socials!
          On the last Saturday of each month, our club members bring food and drink to share.
          These gatherings are a fantastic way to connect with other members over
          homemade baked goods, fruits, snacks, and refreshing beverages, contributed by anyone who wishes!
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
