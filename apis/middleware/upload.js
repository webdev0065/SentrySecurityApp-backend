const multer = require('multer');
const path = require('path');

const incidentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/incidents'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  const allowedExtensions = /\.(jpg|jpeg|png|webp)$/i;

  const hasValidMimetype = allowedTypes.includes(file.mimetype);
  const hasValidExtension = allowedExtensions.test(file.originalname);

  if (hasValidMimetype || hasValidExtension) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, or WEBP images are allowed'), false);
  }
};

const upload = multer({
  storage: incidentStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }
});

const profilePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/profile-photos'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `agency_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const uploadProfilePhoto = multer({
  storage: profilePhotoStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

module.exports = upload;
module.exports.uploadProfilePhoto = uploadProfilePhoto;