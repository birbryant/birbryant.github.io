#JW 05/07/2025
#I had to use google and inspiration for Kera's model to figure out how to predict
#the product of matrices
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
# Define the neural network model
def build_model():
    model = keras.Sequential([
    layers.Input(shape=(8,)), # Input layer: Two 2x2 matrices flattened into an 8-element vector
                                # Hidden layers - Adjusted architecture for better learning
    layers.Dense(64, activation="swish"), # Increased nodes for betterlearning
    layers.BatchNormalization(), # Normalize activations to stabilize learning
    layers.Dense(32, activation="swish"), # Second hidden layer with 32 nodes
    layers.Dense(16, activation="swish"), # Third hidden layer with 16 nodes
    layers.Dense(8, activation="swish"), # Fourth hidden layer with 8 nodes
    layers.Dense(4) # Output layer: Predicting 4 values (2x2 matrix flattened)
    ])
    # Compile the model with improved loss function
    model.compile(optimizer=keras.optimizers.Adam(learning_rate=0.0005),
    loss=tf.keras.losses.MeanSquaredError(), metrics=["mae"])
    return model

# Generate training data for matrix multiplication
def generate_data(num_samples=100000):
    A = np.random.uniform(-10, 10, (num_samples, 2, 2)) # First matrix
    B = np.random.uniform(-10, 10, (num_samples, 2, 2)) # Second matrix 
    X = np.hstack((A.reshape(num_samples, -1), B.reshape(num_samples, -1))) #Flatten and concatenate matrices
    Y = np.matmul(A, B).reshape(num_samples, -1) # Compute matrix product andflatten
    return X.astype(np.float32), Y.astype(np.float32) # No scaling applied here

# Create training and testing datasets
X_train, Y_train = generate_data(100000)
X_test, Y_test = generate_data(10000)

# Build and train the model
model = build_model()
model.fit(X_train, Y_train, epochs=300, batch_size=512, validation_data=(X_test,Y_test))

# Evaluate the model
test_loss, test_mae = model.evaluate(X_test, Y_test)
print(f"Test MAE: {test_mae}")

# Function to predict matrix multiplication
def predicted_product(matrix1, matrix2):
    A = np.array(matrix1, dtype=np.float32) # No normalization for input here
    B = np.array(matrix2, dtype=np.float32)
    X_mats = np.hstack((A.flatten(), B.flatten())).reshape(1, -1) # Flatten and
    concatenate
    return model.predict(X_mats).reshape(2, 2) # No scaling of output necessary